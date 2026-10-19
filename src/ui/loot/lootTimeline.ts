import { clamp01, easeInCubic, easeOutBack, easeOutCubic, lerp } from "../../core/easing";

/**
 * Хронология одной находки — чистая математика без DOM: по времени от старта
 * возвращает позу карточки (куда, какого размера, как повёрнута, насколько
 * видна). Благодаря этому анимацию можно проверить тестом, ускорить простым
 * умножением времени и не зависеть от CSS/Web Animations на слабых устройствах.
 *
 *   emerge — вылетает из сундука к центру экрана (пружинит при остановке);
 *   hold   — парит в центре, чтобы её можно было рассмотреть;
 *   fly    — уменьшается и улетает к рюкзаку, закручиваясь по дуге.
 */

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Три опорные точки пути, CSS px. */
export interface LootPath {
  from: ScreenPoint;
  center: ScreenPoint;
  to: ScreenPoint;
  /** Высота дуги вылета/полёта, px (зависит от размера экрана). */
  arc: number;
  /** «Спокойный» режим (prefers-reduced-motion): без кручения и дуг. */
  calm?: boolean;
}

export type LootPhase = "emerge" | "hold" | "fly" | "done";

export interface LootPose {
  phase: LootPhase;
  x: number;
  y: number;
  scale: number;
  /** Градусы. */
  rotate: number;
  opacity: number;
  /** Сила свечения за карточкой, 0…1. */
  glow: number;
}

export const EMERGE_SECONDS = 0.6;
export const HOLD_SECONDS = 1.5;
export const FLY_SECONDS = 0.65;
/** Длительность одной находки без ускорения (≈ «пара секунд» из задачи). */
export const ITEM_SECONDS = EMERGE_SECONDS + HOLD_SECONDS + FLY_SECONDS;

const START_SCALE = 0.06;
const END_SCALE = 0.05;
const HOLD_GLOW = 0.8;

export function newPose(): LootPose {
  return { phase: "emerge", x: 0, y: 0, scale: 0, rotate: 0, opacity: 0, glow: 0 };
}

/**
 * Поза в момент t (секунды от начала находки). `out` переиспользуется — без
 * аллокаций в кадре. Позы на стыках фаз совпадают (нет «скачков»).
 */
export function lootPoseAt(t: number, path: LootPath, tilt: number, out: LootPose = newPose()): LootPose {
  const { from, center, to, calm } = path;
  const arc = calm ? 0 : path.arc;
  const spin = calm ? 0 : 1;

  if (t < EMERGE_SECONDS) {
    const u = clamp01(t / EMERGE_SECONDS);
    out.phase = "emerge";
    out.x = lerp(from.x, center.x, easeOutCubic(u));
    out.y = lerp(from.y, center.y, easeOutCubic(u)) - Math.sin(Math.PI * u) * arc;
    out.scale = lerp(START_SCALE, 1, easeOutBack(u, 1.1));
    out.rotate = lerp(tilt - 28 * spin, tilt, easeOutCubic(u));
    out.opacity = clamp01(u * 3);
    out.glow = HOLD_GLOW * u;
    return out;
  }

  if (t < EMERGE_SECONDS + HOLD_SECONDS) {
    const v = (t - EMERGE_SECONDS) / HOLD_SECONDS;
    const wave = Math.sin(Math.PI * 2 * v); // ровно один период: на краях фазы ноль
    out.phase = "hold";
    out.x = center.x;
    out.y = center.y + wave * (calm ? 0 : 5);
    out.scale = 1 + wave * (calm ? 0 : 0.012);
    out.rotate = tilt + wave * (calm ? 0 : 0.6);
    out.opacity = 1;
    out.glow = HOLD_GLOW + 0.2 * Math.sin(Math.PI * 4 * v);
    return out;
  }

  const w = (t - EMERGE_SECONDS - HOLD_SECONDS) / FLY_SECONDS;
  if (w < 1) {
    const e = easeInCubic(w);
    out.phase = "fly";
    out.x = lerp(center.x, to.x, e);
    out.y = lerp(center.y, to.y, e) - Math.sin(Math.PI * w) * arc * 0.6;
    out.scale = lerp(1, END_SCALE, e);
    out.rotate = tilt + 240 * spin * e;
    out.opacity = 1 - clamp01((w - 0.7) / 0.3);
    out.glow = HOLD_GLOW * (1 - w);
    return out;
  }

  out.phase = "done";
  out.x = to.x;
  out.y = to.y;
  out.scale = END_SCALE;
  out.rotate = tilt + 240 * spin;
  out.opacity = 0;
  out.glow = 0;
  return out;
}
