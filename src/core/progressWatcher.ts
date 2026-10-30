import type { GameStateSnapshot } from "./GameState";

/** Сколько всего у игрока того, чему он может обрадоваться. */
export interface ProgressCounts {
  learned: number;
  gates: number;
  /** Найденные книги и страницы вместе. */
  treasures: number;
}

/** Что прибавилось с прошлого раза. */
export interface ProgressDelta {
  spellLearned: boolean;
  gateOpened: boolean;
  treasure: boolean;
}

/** Считает прогресс по снимку состояния (снимок собирается редко — по событиям, не покадрово). */
export function countProgress(state: { snapshot(): GameStateSnapshot }): ProgressCounts {
  const s = state.snapshot();
  return { learned: s.learned.length, gates: s.openedGateIds.length, treasures: s.bookPageIds.length + s.bookIds.length };
}

/**
 * Замечает, что у игрока прибавилось: выучил заклинание, разрушил барьер, нашёл книгу или страницу.
 * Уменьшение (например, загрузка другого сохранения) — не повод радоваться: просто новая точка отсчёта.
 * Начальное состояние запоминается при создании, поэтому загруженный прогресс радости не вызывает.
 */
export class ProgressWatcher {
  private last: ProgressCounts;

  constructor(private readonly read: () => ProgressCounts) {
    this.last = read();
  }

  public poll(): ProgressDelta {
    const now = this.read();
    const delta: ProgressDelta = {
      spellLearned: now.learned > this.last.learned,
      gateOpened: now.gates > this.last.gates,
      treasure: now.treasures > this.last.treasures,
    };
    this.last = now;
    return delta;
  }
}
