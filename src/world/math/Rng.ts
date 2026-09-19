/**
 * Детерминированный генератор случайных чисел и хелперы диапазонов.
 *
 * Mulberry32 — компактный 32-битный PRNG: генерация воспроизводима при
 * известном seed и НЕ зависит от Math.random напрямую (ключевое для тестов и
 * для «продления мира» — состояние сериализуемо через Rng.state).
 *
 * Единый источник rng-утилит: раньше randRange/randInt/pick были продублированы
 * в WorldGenerator и SectionContent — теперь все потребители берут их отсюда.
 */

/** «Сырая» функция-генератор: возвращает [0, 1). Единый вход для потребителей. */
export type RandomFn = () => number;

const MULBERRY_STEP = 0x6d2b79f5;

/**
 * Stateful PRNG с сериализуемым состоянием.
 * - `next()` сдвигает состояние и возвращает [0, 1);
 * - `fn` — «сырая» функция-генератор (совместима с RandomFn, которую ожидает
 *   SectionContentBuilder);
 * - `state` / `fromState` — снапшот и восстановление (продление того же мира).
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed | 0;
  }

  public next(): number {
    let s = this.s;
    s = (s + MULBERRY_STEP) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    this.s = s;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Текущее внутреннее состояние (для снапшота генерации). */
  public get state(): number {
    return this.s;
  }

  /** «Сырая» функция-генератор — совместима с RandomFn. */
  public get fn(): RandomFn {
    return () => this.next();
  }

  /** Восстановить PRNG из ранее снятого состояния (продление того же мира). */
  public static fromState(state: number): Rng {
    const rng = new Rng(0);
    rng.s = state | 0;
    return rng;
  }
}

/** Совместимость/удобство: функция-генератор по seed (как mulberry32 раньше). */
export function mulberry32(seed: number): RandomFn {
  return new Rng(seed).fn;
}

export function randRange(rng: RandomFn, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function randInt(rng: RandomFn, min: number, max: number): number {
  return Math.floor(randRange(rng, min, max + 1));
}

export function pick<T>(rng: RandomFn, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Случайный знак ±1 (зеркальные развороты веток развилки). */
export function randSign(rng: RandomFn): 1 | -1 {
  return rng() < 0.5 ? 1 : -1;
}

/** Бросок «с вероятностью p» (эквивалент `rng() < p`). */
export function chance(rng: RandomFn, p: number): boolean {
  return rng() < p;
}
