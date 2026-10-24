import { TRAINING_WITCH_POWER, WITCH_POWER } from "../combat/combatBalance";

/**
 * Баланс дуэлей: индекс секции -> сила ведьмы. Первая секция — тренировочная:
 * ведьма слабая, хватает одного верного удара.
 */
const WITCH_POWER_BY_SECTION: Readonly<Record<number, number>> = { 0: TRAINING_WITCH_POWER };

/** Сколько Силы у ведьмы в секции с данным индексом. */
export function witchPowerFor(sectionIndex: number): number {
  return WITCH_POWER_BY_SECTION[sectionIndex] ?? WITCH_POWER;
}
