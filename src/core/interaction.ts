import { MobileControls } from "../mobile/MobileControls";
import { ProximityDetector } from "../world/proximity";
import type { GameManagers } from "./managers";
import type { GameState } from "./GameState";
import type { ChestContents } from "../entities/Chest";

export interface InteractionApi {
  mobile: MobileControls;
  /** Открыто ли любое меню/бой (блокирует движение и «горячие» клавиши). */
  anyMenuOpen(): boolean;
}

export interface InteractionDeps {
  managers: GameManagers;
  proximity: ProximityDetector;
  gameState: GameState;
  duelRoundsToWin: () => number;
  /** Принудительно включить мобильные контролы (эмуляция с компа). */
  emulateMobile: boolean;
}

/**
 * Ввод: общая логика клавиши E/мобильной кнопки «взаимодействие», горячие
 * клавиши (G — граф, Escape — закрыть меню) и создание мобильных контролов.
 *
 * handleInteract использует результат детекта ближайших объектов (ProximityDetector):
 * ворота > костёр > дружелюбная ведьма > тренировочная цель.
 */
export function createInteraction(deps: InteractionDeps): InteractionApi {
  const { managers, proximity, gameState } = deps;

  /**
   * Содержимое сундука переезжает в состояние игрока: страницы книг
   * помечаются собранными (книги — набором своих страниц). Повторная сборка
   * чанка (WorldStreamer) не потеряет прогресс — GameState это переживает.
   */
  const collectContents = (contents: ChestContents): void => {
    for (const book of contents.books) {
      for (const page of book.pages) gameState.collectBookPage(page.id);
    }
    for (const id of contents.pageIds) gameState.collectBookPage(id);
  };

  const anyMenuOpen = (): boolean =>
    managers.combat.isActive ||
    managers.spellGraph.isOpen ||
    managers.learning.isActive ||
    managers.practice.isActive ||
    managers.gates.isActive;

  const handleInteract = (): void => {
    const { combat, spellGraph, learning, practice, gates } = managers;
    if (combat.isActive || spellGraph.isOpen) return;
    if (proximity.nearGate) {
      if (gates.isActive) gates.close();
      else gates.open(proximity.nearGate);
    } else if (proximity.nearBonfire) {
      if (learning.isActive) learning.close();
      else learning.open();
    } else if (proximity.nearChest) {
      const contents = proximity.nearChest.open();
      collectContents(contents);
      // eslint-disable-next-line no-console
      console.log(
        `[chest] ${proximity.nearChest.id} открыт: книги=[${contents.books.map((b) => b.id).join(",") || "-"}] страницы=[${contents.pageIds.join(",") || "-"}]`
      );
    } else if (proximity.nearFriendlyWitch) {
      combat.startEncounter(proximity.nearFriendlyWitch, deps.duelRoundsToWin());
    } else if (proximity.nearPracticeTarget) {
      if (practice.isActive) practice.close();
      else practice.open();
    }
  };

  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (key === "g" && !anyMenuOpen()) {
      managers.spellGraph.toggle();
    } else if (key === "escape") {
      if (managers.spellGraph.isOpen) managers.spellGraph.close();
      if (managers.learning.isActive) managers.learning.close();
      if (managers.practice.isActive) managers.practice.close();
      if (managers.gates.isActive) managers.gates.close();
    } else if (key === "e") {
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
