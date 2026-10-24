import { FATIGUE_FREE_USES, FATIGUE_MIN_MULTIPLIER, FATIGUE_STEP, FATIGUE_WINDOW } from "./combatBalance";

export interface FatigueConfig {
  /** Сколько последних применений помним. */
  window: number;
  /** Сколько применений в окне заклинание бьёт на полную. */
  freeUses: number;
  /** Потеря урона за каждое применение сверх бесплатных (0.2 = −20 %). */
  step: number;
  /** Нижняя граница множителя урона. */
  minMultiplier: number;
}

export const DEFAULT_FATIGUE: FatigueConfig = {
  window: FATIGUE_WINDOW,
  freeUses: FATIGUE_FREE_USES,
  step: FATIGUE_STEP,
  minMultiplier: FATIGUE_MIN_MULTIPLIER,
};

/**
 * Множитель урона для n-го применения заклинания в окне (n считается вместе с
 * текущим): первые freeUses — 1.0, дальше каждое следующее на step слабее,
 * но не ниже minMultiplier.
 */
export function fatigueMultiplier(usesIncludingThisCast: number, cfg: FatigueConfig = DEFAULT_FATIGUE): number {
  const over = Math.max(0, usesIncludingThisCast - cfg.freeUses);
  return Math.max(cfg.minMultiplier, 1 - cfg.step * over);
}

/**
 * Память об усталости заклинаний: помнит последние удачные применения (скользящее
 * окно) и по доле конкретного заклинания в нём говорит, насколько оно «выдохлось».
 * Окно общее для всех боёв и тренировок, поэтому, чтобы бить в полную силу, приходится
 * чередовать заклинания, то есть учить новые.
 *
 * Состояние живёт в памяти сессии (в сохранения не пишется).
 */
export class SpellFatigue {
  private recent: string[] = [];

  constructor(private readonly cfg: FatigueConfig = DEFAULT_FATIGUE) {}

  /** Сколько раз заклинание применялось в последних `window` применениях. */
  public usesInWindow(spellId: string): number {
    let n = 0;
    for (const id of this.recent) if (id === spellId) n++;
    return n;
  }

  /** Множитель урона, если произнести заклинание прямо сейчас (с учётом этого применения). */
  public multiplierFor(spellId: string): number {
    return fatigueMultiplier(this.usesInWindow(spellId) + 1, this.cfg);
  }

  /** Запомнить удачное применение заклинания. */
  public record(spellId: string): void {
    this.recent.push(spellId);
    if (this.recent.length > this.cfg.window) this.recent.splice(0, this.recent.length - this.cfg.window);
  }

  public reset(): void {
    this.recent = [];
  }

  /** Копия окна (для тестов и возможного сохранения в будущем). */
  public snapshot(): string[] {
    return [...this.recent];
  }
}
