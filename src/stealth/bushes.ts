import type { AbstractMesh } from "@babylonjs/core";
import type { SightBlocker } from "./cover";

/**
 * Куст как «укрытие»: круг на плоскости XZ + визуал с плавной прозрачностью.
 * Бывает двух видов: отдельный куст посреди коридора ("bush") и заросли у края
 * коридора ("thicket", стиль границы секции "bushes"). Создаётся SectionChunk
 * при сборке секции и живёт ровно столько же, сколько чанк.
 *
 * Игрок внутри круга невидим для ведьм. Кроме того, куст перекрывает обзор
 * (blockRadius — сечение кроны на высоте глаз ведьмы), так что за кустом тоже
 * можно скрыться от взгляда — см. cover.isSightBlocked.
 */
export interface BushVolume extends SightBlocker {
  kind: "bush" | "thicket";
  x: number;
  z: number;
  /** Радиус кроны в метрах (радиус сферы 1.2 × scale). */
  radius: number;
  /** Видимый меш (у зарослей — инстанс общей основы). */
  mesh: AbstractMesh;
  /** Текущая прозрачность (1 — полностью видим). Двигается StealthManager-ом через setAlpha. */
  alpha: number;
  /**
   * Применяет прозрачность к визуалу. У отдельного куста это просто mesh.visibility;
   * у зарослей (инстансы, у которых прозрачности по одному нет) — подмена инстанса
   * на призрачный меш-двойник, пока куст прозрачен.
   */
  setAlpha(alpha: number): void;
}

/**
 * Игрок считается «в кусте», когда его центр внутри этой доли радиуса кроны:
 * на самом краю куста тело ещё торчит наружу, так что прятаться надо заходить глубже.
 */
export const BUSH_HIDE_FACTOR = 0.85;

/** Куст, в котором прямо сейчас спрятан игрок (или null). При пересечении кустов — ближайший к центру. */
export function findHidingBush(bushes: readonly BushVolume[], x: number, z: number): BushVolume | null {
  let best: BushVolume | null = null;
  let bestRatio = Infinity;
  for (const b of bushes) {
    const ratio = Math.hypot(x - b.x, z - b.z) / (b.radius * BUSH_HIDE_FACTOR);
    if (ratio <= 1 && ratio < bestRatio) {
      best = b;
      bestRatio = ratio;
    }
  }
  return best;
}

/** Круг кроны накрывает игрока: этот куст (и соседние заросли) становятся полупрозрачными. */
export function bushCoversPlayer(b: BushVolume, x: number, z: number): boolean {
  return Math.hypot(x - b.x, z - b.z) <= b.radius;
}
