import { Vector3 } from "@babylonjs/core";
import { MobileControls } from "../mobile/MobileControls";
import { ProximityDetector } from "../world/proximity";
import type { GameManagers } from "./managers";
import type { GameState } from "./GameState";
import type { Backpack } from "../entities/Backpack";
import type { Chest } from "../entities/Chest";
import type { KeyBindings } from "./KeyBindings";
import type { ScreenProjector } from "./screenProjection";
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
  duelRoundsToWin: () => number;
  /** Принудительно включить мобильные контролы (эмуляция с компа). */
  emulateMobile: boolean;
}

/**
 * Ввод: общая логика клавиши «взаимодействие»/мобильной кнопки, горячие клавиши
 * (граф заклинаний; Escape — закрыть меню) и создание мобильных контролов.
 * Клавиши действий переназначаются в настройках (см. KeyBindings); Escape как
 * «закрыть/назад» зашит всегда.
 *
 * handleInteract использует результат детекта ближайших объектов (ProximityDetector):
 * ворота > костёр > сундук > дружелюбная ведьма > тренировочная цель.
 */
export function createInteraction(deps: InteractionDeps): InteractionApi {
  const { managers, proximity } = deps;

  const anyMenuOpen = (): boolean =>
    managers.combat.isActive ||
    managers.spellGraph.isOpen ||
    managers.learning.isActive ||
    managers.practice.isActive ||
    managers.gates.isActive ||
    managers.chestLoot.isOpen ||
    managers.lootPresenter.isActive;

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
    const { combat, spellGraph, learning, practice, gates, chestLoot, lootPresenter } = managers;
    if (combat.isActive || spellGraph.isOpen || lootPresenter.isActive) return;
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
      combat.startEncounter(proximity.nearFriendlyWitch, deps.duelRoundsToWin());
    } else if (proximity.nearPracticeTarget) {
      if (practice.isActive) practice.close();
      else practice.open();
    }
  };

  window.addEventListener("keydown", (e) => {
    // Печать ответа в поле ввода (бой, костёр, ворота) не должна срабатывать как «взаимодействие» или «граф».
    const typing = isTypingTarget(e.target);
    if (e.code === "Escape") {
      if (managers.spellGraph.isOpen) managers.spellGraph.close();
      if (managers.learning.isActive) managers.learning.close();
      if (managers.practice.isActive) managers.practice.close();
      if (managers.gates.isActive) managers.gates.close();
      if (managers.chestLoot.isOpen) managers.chestLoot.close();
    } else if (typing) {
      return;
    } else if (deps.keys.matches("spellGraph", e) && !anyMenuOpen()) {
      managers.spellGraph.toggle();
    } else if (deps.keys.matches("interact", e)) {
      handleInteract();
    }
  });

  const mobile = new MobileControls({
    onInteract: () => handleInteract(),
    onSpellGraph: () => {
      if (!anyMenuOpen() && !managers.spellGraph.isOpen) managers.spellGraph.toggle();
    },
    force: deps.emulateMobile,
  });

  return { mobile, anyMenuOpen };
}
