import type { StrikeResult } from "../BattleStage";

/**
 * Геометрия 3D-сцены боя: позы камеры и конечные точки ударов. Чистые функции без Babylon —
 * их можно проверять числами (см. scripts/test-battle-stage.ts).
 *
 * Соглашения те же, что в остальной игре: курс (yaw) 0 = +Z, направление взгляда (sin yaw, cos yaw).
 * ArcRotateCamera стоит в точке target + radius·(cosα·sinβ, cosβ, sinα·sinβ).
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Поза орбитальной камеры. */
export interface CameraPose {
  alpha: number;
  beta: number;
  radius: number;
  target: Vec3;
}

/** Камера «за спиной»: чуть сдвинута к правому плечу, чтобы игрок не заслонял противника (рад). */
export const SHOULDER_OFFSET = 0.2;
/** Ракурс удара: насколько камера сдвинута от бокового вида к спине бьющего (рад). */
export const SHOT_BACK_BIAS = 0.45;
/** Наклон камеры (от вертикали): у «за спиной» — как в обычной игре, у удара — почти по горизонту. */
export const REST_BETA = 1.2;
export const SHOT_BETA = 1.3;
/** Дистанции камеры: за спиной (границы) и на ударе (от расстояния между бойцами). */
export const REST_RADIUS_MIN = 5;
export const REST_RADIUS_MAX = 8;
export const SHOT_RADIUS_MIN = 5;
export const SHOT_RADIUS_MAX = 8.5;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Курс из точки A в сторону точки B. */
export function yawToward(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

/** Кратчайшая разница углов to − from, в (−π, π]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Камера за спиной игрока, который смотрит по курсу yaw: цель — сам игрок (так камера бесшовно возвращается к обычному следованию). */
export function behindPlayerPose(player: Vec3, yaw: number, preferredRadius: number): CameraPose {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  // right = (cos yaw, −sin yaw); камера: назад и чуть вправо.
  const dx = -fx * Math.cos(SHOULDER_OFFSET) + fz * Math.sin(SHOULDER_OFFSET);
  const dz = -fz * Math.cos(SHOULDER_OFFSET) - fx * Math.sin(SHOULDER_OFFSET);
  return {
    alpha: Math.atan2(dz, dx),
    beta: REST_BETA,
    radius: clamp(preferredRadius, REST_RADIUS_MIN, REST_RADIUS_MAX),
    target: { x: player.x, y: player.y, z: player.z },
  };
}

/**
 * Ракурс удара: камера сбоку от линии «бьющий → цель», чуть со стороны спины бьющего, и смотрит на середину
 * этой линии — видно и замах, и полёт, и попадание. Сторону выбираем ту, где камера уже стоит (currentAlpha),
 * чтобы не облетать сцену на 180°.
 */
export function strikeShotPose(attacker: Vec3, defender: Vec3, currentAlpha: number): CameraPose {
  const lx = defender.x - attacker.x;
  const lz = defender.z - attacker.z;
  const len = Math.hypot(lx, lz);
  const dx = len > 1e-4 ? lx / len : 0;
  const dz = len > 1e-4 ? lz / len : 1;

  // Перпендикуляр к линии удара: выбираем сторону, ближнюю к текущей камере.
  let px = dz;
  let pz = -dx;
  if (px * Math.cos(currentAlpha) + pz * Math.sin(currentAlpha) < 0) {
    px = -px;
    pz = -pz;
  }
  const cosB = Math.cos(SHOT_BACK_BIAS);
  const sinB = Math.sin(SHOT_BACK_BIAS);
  const cx = px * cosB - dx * sinB; // сдвиг от бокового вида к спине бьющего
  const cz = pz * cosB - dz * sinB;

  return {
    alpha: Math.atan2(cz, cx),
    beta: SHOT_BETA,
    radius: clamp(len * 1.5 + 3.2, SHOT_RADIUS_MIN, SHOT_RADIUS_MAX),
    target: { x: (attacker.x + defender.x) / 2, y: (attacker.y + defender.y) / 2, z: (attacker.z + defender.z) / 2 },
  };
}

/** Линейная интерполяция поз; угол α идёт кратчайшим путём. */
export function lerpPose(a: CameraPose, b: CameraPose, t: number, out: CameraPose): CameraPose {
  out.alpha = a.alpha + angleDelta(a.alpha, b.alpha) * t;
  out.beta = a.beta + (b.beta - a.beta) * t;
  out.radius = a.radius + (b.radius - a.radius) * t;
  out.target.x = a.target.x + (b.target.x - a.target.x) * t;
  out.target.y = a.target.y + (b.target.y - a.target.y) * t;
  out.target.z = a.target.z + (b.target.z - a.target.z) * t;
  return out;
}

/** Куда на самом деле летит заклинание: в цель, в «щит» перед ней или мимо. */
export function strikeEndPoint(from: Vec3, to: Vec3, result: StrikeResult): Vec3 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  switch (result) {
    case "hit":
      return { x: to.x, y: to.y, z: to.z };
    case "blocked": {
      // Заклинание бьётся о щит, не долетев до цели.
      const k = 0.72;
      return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z: from.z + (to.z - from.z) * k };
    }
    case "missed": {
      // Пролетает сбоку и чуть выше цели.
      const side = 1.5;
      return { x: to.x + (dz / len) * side + (dx / len) * 0.8, y: to.y + 0.6, z: to.z - (dx / len) * side + (dz / len) * 0.8 };
    }
  }
}
