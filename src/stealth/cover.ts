import type { Mesh } from "@babylonjs/core";

/**
 * cover.ts — укрытия от взгляда ведьмы: всё, что стоит между ней и игроком и
 * перекрывает обзор (кусты, заросли у края коридора, деревья). Чистая 2D-геометрия
 * без Babylon, чтобы её можно было проверять в Node.
 *
 * Объекты считаются кругами на плоскости XZ — сечением сферы на высоте глаз ведьмы.
 */

/** Высота глаз ведьмы (и условная высота взгляда на игрока), м. */
export const EYE_HEIGHT = 1.4;

/** Сколько метров взгляд должен пройти ВНУТРИ круга, чтобы считаться перекрытым (скользящий край не в счёт). */
export const MIN_BLOCK_CHORD = 0.35;

/** Всё, что перекрывает обзор. blockRadius — радиус сечения на высоте глаз. */
export interface SightBlocker {
  x: number;
  z: number;
  blockRadius: number;
}

/**
 * Радиус сечения сферы (радиус `radius`, центр на высоте `centerY`) плоскостью на
 * высоте глаз. 0 — глаза выше/ниже сферы (не перекрывает).
 */
export function eyeLevelRadius(radius: number, centerY: number): number {
  const dy = EYE_HEIGHT - centerY;
  const r2 = radius * radius - dy * dy;
  return r2 > 0 ? Math.sqrt(r2) : 0;
}

/**
 * Перекрывает ли хоть одно укрытие линию взгляда (fx,fz) → (tx,tz).
 * Укрытие, внутри которого стоит сам смотрящий, не считается (иначе ведьма в
 * кустах «ослепла» бы). Принимает несколько списков, чтобы не склеивать массивы.
 */
export function isSightBlocked(
  fx: number,
  fz: number,
  tx: number,
  tz: number,
  groups: readonly (readonly SightBlocker[])[]
): boolean {
  const dx = tx - fx;
  const dz = tz - fz;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return false;
  const ux = dx / len;
  const uz = dz / len;

  for (const group of groups) {
    for (const b of group) {
      const r = b.blockRadius;
      if (r <= 0) continue;
      const cx = b.x - fx;
      const cz = b.z - fz;
      const c2 = cx * cx + cz * cz;
      if (c2 <= r * r) continue; // смотрящий внутри этого укрытия
      const t = cx * ux + cz * uz; // проекция центра на луч
      const d2 = c2 - t * t; // квадрат расстояния от центра до луча
      if (d2 >= r * r) continue;
      const h = Math.sqrt(r * r - d2);
      const entry = Math.max(0, t - h);
      const exit = Math.min(len, t + h);
      if (exit - entry >= MIN_BLOCK_CHORD) return true;
    }
  }
  return false;
}

/**
 * Дерево из рощи: перекрывает обзор (крона на уровне глаз) и физически стоит
 * стволом. Прозрачной становится крона, когда она между камерой и игроком —
 * иначе высокое дерево закрыло бы героя от зрителя (камера свободно вращается).
 */
export interface TreeVolume extends SightBlocker {
  /** Крона — сфера радиуса canopyRadius с центром на высоте canopyY над (x, z). */
  canopyY: number;
  canopyRadius: number;
  canopy: Mesh;
  /** Текущая прозрачность кроны (1 — непрозрачна). Двигается StealthManager-ом. */
  alpha: number;
}
