import { Hud } from "./Hud";
import { GameState } from "./GameState";
import { EncounterCooldown } from "./encounterCooldown";
import { CombatManager } from "../combat/CombatManager";
import { NULL_BATTLE_STAGE } from "../combat/BattleStage";
import type { BattleStage } from "../combat/BattleStage";
import { PowerPool } from "../combat/PowerPool";
import { SpellFatigue } from "../combat/SpellFatigue";
import { PLAYER_MAX_POWER } from "../combat/combatBalance";
import type { BattleOutcome } from "../combat/opponent";
import type { Witch } from "../entities/Witch";
import { LearningManager } from "../learning/LearningManager";
import { GateManager } from "../gates/GateManager";
import { SpellGraphScreen } from "../ui/SpellGraphScreen";
import { ChestLootScreen } from "../ui/ChestLootScreen";
import { LootPresenter } from "../ui/loot/LootPresenter";

export interface GameManagers {
  hud: Hud;
  spellGraph: SpellGraphScreen;
  combat: CombatManager;
  /** Шкала Силы игрока: её рисует HUD, тратит бой, возвращает время вне боя. */
  playerPower: PowerPool;
  learning: LearningManager;
  gates: GateManager;
  chestLoot: ChestLootScreen;
  /** Полноэкранная презентация находок (вылет из сундука → рюкзак). */
  lootPresenter: LootPresenter;
}

/**
 * Фабрика UI-менеджеров игры (HUD, бой, граф, обучение, барьеры, находки из сундуков).
 * Исход боя связывает CombatManager с состоянием прогресса (GameState) и
 * ведьмиными кулдаунами (EncounterCooldown); шкала Силы игрока общая у HUD и боя.
 * Тренировка у чучел/деревьев — тоже бой (см. combat/opponent.ts), отдельного менеджера нет.
 */
export function createManagers(
  uiRoot: HTMLElement,
  gameState: GameState,
  cooldown: EncounterCooldown,
  stage: BattleStage = NULL_BATTLE_STAGE
): GameManagers {
  const hud = new Hud(uiRoot);
  const playerPower = new PowerPool(PLAYER_MAX_POWER);
  hud.bindPower(playerPower);

  const spellGraph = new SpellGraphScreen(uiRoot, gameState);

  const resolveWitchBattle = (witch: Witch, outcome: BattleOutcome): void => {
    if (outcome === "won") {
      // Победа не убирает ведьму — она остаётся «дружелюбной», спарринг по E.
      gameState.markWitchDefeated(witch.id);
      witch.setFriendly(true);
      cooldown.notifyDuelEnded();
      return;
    }
    // Проиграл/отступил: ведьма отцепляется и идёт домой (несколько секунд не замечает игрока).
    cooldown.notifyDuelEnded(witch.id);
    witch.disengage();
  };

  const combat = new CombatManager(
    uiRoot,
    { gameState, playerPower, fatigue: new SpellFatigue(), stage },
    {
      onBattleEnd: (opponent, outcome) => {
        switch (opponent.kind) {
          case "witch":
            resolveWitchBattle(opponent.witch, outcome);
            break;
          case "target":
            // Чучело ничего не помнит: следующий бой начнётся с полной шкалы.
            cooldown.notifyDuelEnded();
            break;
        }
      },
    }
  );

  const learning = new LearningManager(uiRoot, gameState, {
    onSpellLearned: () => {
      // Место для будущих эффектов/звука на изучение.
    },
  });

  const gates = new GateManager(uiRoot, gameState, {
    onGateOpened: () => {
      // Место для будущего эффекта «барьер рассеялся».
    },
  });

  const chestLoot = new ChestLootScreen(uiRoot, gameState);

  const lootPresenter = new LootPresenter(uiRoot);

  return { hud, spellGraph, combat, playerPower, learning, gates, chestLoot, lootPresenter };
}
