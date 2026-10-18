import { Hud } from "./Hud";
import { GameState } from "./GameState";
import { EncounterCooldown } from "./encounterCooldown";
import { CombatManager } from "../combat/CombatManager";
import { LearningManager } from "../learning/LearningManager";
import { PracticeManager } from "../practice/PracticeManager";
import { GateManager } from "../gates/GateManager";
import { SpellGraphScreen } from "../ui/SpellGraphScreen";
import { ChestLootScreen } from "../ui/ChestLootScreen";

export interface GameManagers {
  hud: Hud;
  spellGraph: SpellGraphScreen;
  combat: CombatManager;
  learning: LearningManager;
  practice: PracticeManager;
  gates: GateManager;
  chestLoot: ChestLootScreen;
}

/**
 * Фабрика UI-менеджеров игры (HUD, бой, граф, обучение, тренировка, барьеры, находки из сундуков).
 * Боевые колбэки связывают CombatManager с состоянием прогресса (GameState),
 * ведьмеными кулдаунами (EncounterCooldown) и HUD-уроном.
 */
export function createManagers(
  uiRoot: HTMLElement,
  gameState: GameState,
  cooldown: EncounterCooldown
): GameManagers {
  const hud = new Hud(uiRoot, 100);

  const spellGraph = new SpellGraphScreen(uiRoot, gameState);

  const combat = new CombatManager(uiRoot, gameState, {
    onDuelWon: (witch) => {
      // Победа не убирает ведьму — она остаётся «дружелюбной», спарринг по E.
      gameState.markWitchDefeated(witch.id);
      witch.setFriendly(true);
      cooldown.notifyDuelEnded();
    },
    // Проиграл/отступил: ведьма отцепляется и идёт домой (несколько секунд не замечает игрока).
    onDuelLost: (witch) => {
      cooldown.notifyDuelEnded(witch.id);
      witch.disengage();
    },
    onRetreat: (witch) => {
      cooldown.notifyDuelEnded(witch.id);
      witch.disengage();
    },
    onPlayerDamaged: (amount) => hud.damage(amount),
  });

  const learning = new LearningManager(uiRoot, gameState, {
    onSpellLearned: () => {
      // Место для будущих эффектов/звука на изучение.
    },
  });

  const practice = new PracticeManager(uiRoot, gameState);

  const gates = new GateManager(uiRoot, gameState, {
    onGateOpened: () => {
      // Место для будущего эффекта «барьер рассеялся».
    },
  });

  const chestLoot = new ChestLootScreen(uiRoot, gameState);

  return { hud, spellGraph, combat, learning, practice, gates, chestLoot };
}
