import { DEFAULT_ROUNDS_TO_WIN } from "../combat/CombatManager";

/**
 * Баланс дуэлей: индекс секции -> сколько успешных ударов нужно игроку для
 * победы. Первая секция — тренировочная, хватает одного попадания.
 */
const ROUNDS_TO_WIN_BY_SECTION: Readonly<Record<number, number>> = { 0: 1 };

/** Сколько раундов нужно для победы над ведьмой в секции с данным индексом. */
export function duelRoundsFor(sectionIndex: number): number {
  return ROUNDS_TO_WIN_BY_SECTION[sectionIndex] ?? DEFAULT_ROUNDS_TO_WIN;
}
