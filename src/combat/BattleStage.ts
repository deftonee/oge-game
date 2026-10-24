import type { Spell } from "../data/spells";
import type { BattleOpponent } from "./opponent";

/** Чем закончился удар: попал, был отражён щитом (верная защита) или ушёл мимо (неверный ответ). */
export type StrikeResult = "hit" | "blocked" | "missed";

export interface Strike {
  /** Кто бьёт. */
  readonly from: "player" | "opponent";
  /** Каким заклинанием: по нему (его школе) выбирается вид анимации. */
  readonly spell: Spell;
  readonly result: StrikeResult;
  /** Зовётся в момент попадания — шкала Силы падает ровно тогда, когда заклинание достигло цели. */
  readonly onImpact?: () => void;
}

/**
 * «Сцена» боя в 3D-мире: разворачивает бойцов друг к другу, показывает удары и
 * управляет камерой. Менеджер боя знает только этот контракт, поэтому его можно
 * гонять и без сцены (тесты) — см. NULL_BATTLE_STAGE.
 */
export interface BattleStage {
  /** Бой начался: бойцы лицом друг к другу, камера за спиной игрока. */
  begin(opponent: BattleOpponent): void;
  /** Показать удар. Промис завершается, когда анимация закончилась и камера вернулась за спину игрока. */
  strike(strike: Strike): Promise<void>;
  /** Бой закончился: вернуть камеру игроку. */
  end(): void;
}

/** Сцена-пустышка: ничего не рисует, удар «долетает» мгновенно. */
export const NULL_BATTLE_STAGE: BattleStage = {
  begin() {},
  strike(strike) {
    strike.onImpact?.();
    return Promise.resolve();
  },
  end() {},
};
