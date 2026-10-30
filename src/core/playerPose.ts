/**
 * Поза персонажа как набор «каналов» (углов шарниров и сдвигов) и ключевые кадры для них.
 * Чистая математика без Babylon: позы и жесты проверяются числами (см. scripts/test-player-animator.ts).
 *
 * Углы — рад. Знаки — см. PlayerRig: у рук и ног отрицательный pitch — вперёд (−π — вверх),
 * у торса и головы положительный pitch — наклон вперёд; roll правой руки > 0 — в сторону, левой — наоборот;
 * положительный yaw — поворот вправо (к +X при взгляде в +Z).
 */

export const CHANNELS = [
  /** Сдвиг всего тела по высоте, м (прыжок — плюс, присесть — минус). */
  "bodyY",
  /** Поворот всего тела вокруг вертикали (волчок). */
  "bodyYaw",
  "torsoPitch",
  "torsoRoll",
  "torsoYaw",
  "headPitch",
  "headYaw",
  "headRoll",
  "armLPitch",
  "armLRoll",
  "armRPitch",
  "armRRoll",
  "legLPitch",
  "legRPitch",
] as const;

export type Channel = (typeof CHANNELS)[number];
export type PoseValues = Record<Channel, number>;
export type PartialPose = Partial<PoseValues>;

export function emptyPose(): PoseValues {
  const pose = {} as PoseValues;
  for (const c of CHANNELS) pose[c] = 0;
  return pose;
}

/** Ключевой кадр: время (с) и значение канала. */
export type Key = readonly [time: number, value: number];
export type Tracks = Partial<Record<Channel, readonly Key[]>>;

/**
 * Значение дорожки в момент t: между ключами — плавный разгон и торможение (smoothstep),
 * до первого и после последнего — крайнее значение. Два ключа с почти равным временем дают «ступеньку».
 */
export function sampleTrack(keys: readonly Key[], t: number): number {
  const n = keys.length;
  if (n === 0) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 1;
  while (i < n && keys[i][0] <= t) i++;
  const [t0, v0] = keys[i - 1];
  const [t1, v1] = keys[i];
  const span = t1 - t0;
  if (span <= 1e-6) return v1;
  const u = (t - t0) / span;
  return v0 + (v1 - v0) * (u * u * (3 - 2 * u));
}

/** Приоритет жеста: более важный не прерывается менее важным (0 — «от скуки», 1 — реакция мира, 2 — бой). */
export type GesturePriority = 0 | 1 | 2;

export interface GestureDef {
  /** Длительность, с. */
  readonly duration: number;
  readonly tracks: Tracks;
  readonly priority: GesturePriority;
  /**
   * Плавный вход и выход, с (по умолчанию 0.05 и 0.06). Обычно ключи сами выводят позу из нейтрали и
   * возвращают её, поэтому вес жеста только «подклеивает» края. Длинный вход/выход нужен жестам,
   * у которых ключи начинаются или кончаются НЕ в нейтрали (стойка защиты): там плавность даёт вес.
   */
  readonly fadeIn?: number;
  readonly fadeOut?: number;
  /**
   * Через сколько секунд после старта жест можно оборвать шагом. 0 — сразу (почесался и пошёл),
   * не задано — не обрывается никогда (прыжок на костре доигрывается).
   */
  readonly cancelOnMove?: number;
  /** Момент «выпуска» заклинания (с от старта): к нему сцена боя привязывает вылет эффекта. */
  readonly releaseAt?: number;
}

/** Удерживаемая поза (сидит у костра, боевая стойка): живёт, пока её не снимут. Каналы, которых нет, остаются за ходьбой. */
export interface HeldDef {
  readonly values: PartialPose;
  /** Время плавного входа/выхода, с. */
  readonly fade: number;
}

/** Ключи «качелей»: n значений, чередующихся между a и b с шагом dt, начиная с t0. */
export function alt(t0: number, dt: number, n: number, a: number, b: number): Key[] {
  const keys: Key[] = [];
  for (let i = 0; i < n; i++) keys.push([t0 + i * dt, i % 2 === 0 ? a : b]);
  return keys;
}
