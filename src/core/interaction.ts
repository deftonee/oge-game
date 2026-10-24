import { Vector3 } from "@babylonjs/core";
import { MobileControls } from "../mobile/MobileControls";
import type { ProximityDetector } from "../world/proximity";
import type { GameManagers } from "./managers";
import type { GameState } from "./GameState";
import type { Backpack } from "../entities/Backpack";
import type { Chest } from "../entities/Chest";
import type { KeyBindings } from "./KeyBindings";
import type { ScreenProjector } from "./screenProjection";
import type { PauseMenu } from "../ui/pause/PauseMenu";
import type { OpponentFactory } from "../combat/opponent";
import { buildLootItems } from "../ui/loot/lootItems";
import type { LootItem } from "../ui/loot/lootItems";

/** Фокус в поле ввода: клавиши идут в текст, а не в игровые действия. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable === true);
}

export interface InteractionApi {
  mobile: MobileControls;
  /** Открыто ли любое меню/бой (блокирует движение и «горячие» клавиши). */
  anyMenuOpen(): boolean;
  /** Просит поставить игру на паузу (например, вкладку скрыли). Не откроется поверх другого окна или боя. */
  requestPause(): void;
}

export interface InteractionDeps {
  managers: GameManagers;
  proximity: ProximityDetector;
  gameState: GameState;
  /** Ввод по действиям: какие клавиши за что отвечают, решают настройки игрока. */
  keys: KeyBindings;
  /** Рюкзак игрока: находки улетают к нему, найденные книги появляются в нём. */
  backpack: Backpack;
  /** Мировая точка → точка на экране: откуда вылетают и куда улетают находки. */
  screen: ScreenProjector;
  /** Как превратить ведьму/цель в противника боя. */
  opponents: OpponentFactory;
  /** Принудительно включить мобильные контролы (эмуляция с компа). */
  emulateMobile: boolean;
  /** Меню паузы: Esc / клавиша «пауза» / кнопка на экране. Создаётся снаружи (нужны настройки и состояние). */
  pause: PauseMenu;
}

/**
 * Ввод: общая логика клавиши «взаимодействие»/мобильной кнопки, горячие клавиши
 * (граф заклинаний; пауза; Escape — закрыть меню) и создание мобильных контролов.
 * Клавиши действий переназначаются в настройках (см. KeyBindings); Escape как
 * «закрыть/назад» зашит всегда.
 *
 * Пауза: Esc/клавиша «пауза»/мобильная кнопка открывают её, только если нет других
 * окон. Esc сначала закрывает открытые окна и в тот же момент паузу не открывает.
 * Пока пауза открыта, её слушатель (capture на window) не пускает клавиши сюда.
 *
 * handleInteract использует результат детекта ближайших объектов (ProximityDetector):
 * ворота > костёр > сундук > дружелюбная ведьма > тренировочная цель.
 */
export function createInteraction(deps: InteractionDeps): InteractionApi {
  const { managers, proximity, pause } = deps;

  const anyMenuOpen = (): boolean =>
    pause.isOpen ||
    managers.combat.isActive ||
    managers.spellGraph.isOpen ||
    managers.learning.isActive ||
    managers.gates.isActive ||
    managers.chestLoot.isOpen ||
    managers.lootPresenter.isActive;

  /** Открывает паузу, если не открыто ничего другого. */
  const openPause = (): void => {
    if (!anyMenuOpen()) pause.open();
  };

  /** Показывает находки: вылет из сундука на весь экран → полёт к рюкзаку; книга появляется в нём по прилёте. */
  const presentLoot = (chest: Chest, items: LootItem[]): void => {
    const origin = chest.openingPoint;
    const scratch = new Vector3();
    const fromPoint = { x: 0, y: 0 };
    const toPoint = { x: 0, y: 0 };
    managers.lootPresenter.present(items, {
      from: () => deps.screen.pointOf(origin, fromPoint),
      to: () => deps.screen.pointOf(deps.backpack.worldCenter(scratch), toPoint),
      onArrive: (item) => {
        if (item.kind === "book") deps.backpack.addBook(item.id);
      },
    });
  };

  /**
   * Первое открытие сундука с находками — презентация. Повторный осмотр
   * (или сундук без новых находок) показывает прежнее окно со списком.
   * open() сам определяет содержимое и переносит найденное (книги и страницы)
   * в GameState — пересборка секции прогресс не потеряет.
   */
  const openChest = (chest: Chest): void => {
    const firstOpening = !chest.isOpened;
    const contents = chest.open();
    // eslint-disable-next-line no-console
    console.log(
      `[chest] ${chest.id} открыт: книги=[${contents.books.map((b) => b.id).join(",") || "-"}] страницы=[${contents.pages.map((p) => p.id).join(",") || "-"}]`
    );
    const items = firstOpening ? buildLootItems(contents, deps.gameState) : [];
    if (items.length === 0) managers.chestLoot.show(contents);
    else presentLoot(chest, items);
  };

  const handleInteract = (): void => {
    const { combat, spellGraph, learning, gates, chestLoot, lootPresenter } = managers;
    if (pause.isOpen || combat.isActive || spellGraph.isOpen || lootPresenter.isActive) return;
    if (proximity.nearGate) {
      if (gates.isActive) gates.close();
      else gates.open(proximity.nearGate);
    } else if (proximity.nearBonfire) {
      if (learning.isActive) learning.close();
      else learning.open();
    } else if (proximity.nearChest) {
      if (chestLoot.isOpen) return;
      openChest(proximity.nearChest);
    } else if (proximity.nearFriendlyWitch) {
      combat.startEncounter(deps.opponents.witch(proximity.nearFriendlyWitch));
    } else if (proximity.nearPracticeTarget) {
      combat.startEncounter(deps.opponents.target(proximity.nearPracticeTarget));
    }
  };

  window.addEventListener("keydown", (e) => {
    // Печать ответа в поле ввода (бой, костёр, ворота) не должна срабатывать как «взаимодействие» или «граф».
    const typing = isTypingTarget(e.target);
    if (e.code === "Escape") {
      // Если что-то было открыто (даже окно, которое Esc не закрывает, — бой), паузу не открываем:
      // Esc закрыл окно — этим «нажатие» и потрачено.
      const hadMenu = anyMenuOpen();
      if (managers.spellGraph.isOpen) managers.spellGraph.close();
      if (managers.learning.isActive) managers.learning.close();
      if (managers.gates.isActive) managers.gates.close();
      if (managers.chestLoot.isOpen) managers.chestLoot.close();
      // Автоповтор зажатого Esc паузу не открывает (иначе она тут же закрылась бы следующим повтором).
      if (!hadMenu && !e.repeat && deps.keys.matches("pause", e)) pause.open();
    } else if (typing) {
      return;
    } else if (deps.keys.matches("spellGraph", e) && !anyMenuOpen()) {
      managers.spellGraph.toggle();
    } else if (deps.keys.matches("interact", e)) {
      handleInteract();
    } else if (deps.keys.matches("pause", e) && !e.repeat) {
      openPause();
    }
  });

  const mobile = new MobileControls({
    onInteract: () => handleInteract(),
    onSpellGraph: () => {
      if (!anyMenuOpen() && !managers.spellGraph.isOpen) managers.spellGraph.toggle();
    },
    onPause: () => openPause(),
    force: deps.emulateMobile,
  });

  return { mobile, anyMenuOpen, requestPause: openPause };
}
