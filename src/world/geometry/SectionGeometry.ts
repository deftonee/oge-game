/**
 * Геометрия секции коридора. Ось секции — дуга ПОСТОЯННОЙ кривизны
 * (curvature=0 — прямая): курс в точке пути s равен `yaw + curvature*s`,
 * позиция на осевой линии — замкнутая формула дуги окружности.
 *
 * Все функции ниже — ЧИСТАЯ математика без состояния и без rng: их можно
 * переиспользовать из любого слоя (генератор, чанк геометрии, стример, туман).
 *
 * Точка расширения «сложный рельеф» (ломанный, сегментный): ось описана
 * минимальным набором (start, yaw, curvature, length), а функции принимают
 * структурные типы ArcFrame/AxialFrame — поэтому ЛЮБУЮ секцию с этими полями
 * они обрабатывают единообразно. Чтобы ввести ломаный рельеф, достаточно
 * добавить сюда альтернативную реализацию (полилиния дуг) и новые sample* —
 * потребители (пол/стены/стример/туман) читают только через эту поверхность.
 */

export interface Vec2 {
  x: number;
  z: number;
}

/** Ось секции без длины (для yawAt/localToWorld). */
export interface ArcFrame {
  start: Vec2;
  yaw: number;
  curvature: number;
}

/** Ось секции с длиной (для расстояний и сэмплинга). */
export interface AxialFrame extends ArcFrame {
  length: number;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Нормализация угла в (-π, π]. */
export function normAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/** Курс (направление) оси секции в точке localZ вдоль её длины. */
export function yawAt(section: Pick<ArcFrame, "yaw" | "curvature">, localZ: number): number {
  return section.yaw + section.curvature * localZ;
}

/**
 * Перевод локальных координат секции (x — поперёк, z — вдоль оси) в мировые.
 * Секция — дуга ПОСТОЯННОЙ кривизны (curvature=0 — прямая, ровно как раньше):
 * курс в точке localZ равен yawAt(section, localZ), позиция на осевой линии —
 * замкнутая формула дуги окружности (интеграл (sin,cos)(yaw(s)) ds, s=0..localZ).
 * localX откладывается ПЕРПЕНДИКУЛЯРНО оси именно В ТОЧКЕ localZ (локальный
 * репер Френе), поэтому при curvature=0 формула даёт ТОЧНО то же самое, что
 * и прямая: dx/ds=sin(yaw(s)), dz/ds=cos(yaw(s)), значение в s=0 равно start.
 */
export function localToWorld(section: ArcFrame, localX: number, localZ: number): Vec2 {
  const c = section.curvature;
  const yaw0 = section.yaw;
  let centerlineX: number;
  let centerlineZ: number;
  if (Math.abs(c) < 1e-9) {
    centerlineX = section.start.x + localZ * Math.sin(yaw0);
    centerlineZ = section.start.z + localZ * Math.cos(yaw0);
  } else {
    const yaw1 = yaw0 + c * localZ;
    centerlineX = section.start.x + (Math.cos(yaw0) - Math.cos(yaw1)) / c;
    centerlineZ = section.start.z + (Math.sin(yaw1) - Math.sin(yaw0)) / c;
  }
  const yawS = yawAt(section, localZ);
  const perpX = Math.cos(yawS);
  const perpZ = -Math.sin(yawS);
  return { x: centerlineX + localX * perpX, z: centerlineZ + localX * perpZ };
}

/** Расстояние от точки до отрезка между двумя произвольными точками. */
export function distPointToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  let t = 0;
  if (lenSq > 1e-12) {
    t = clamp(((px - ax) * dx + (pz - az) * dz) / lenSq, 0, 1);
  }
  const cx = ax + dx * t;
  const cz = az + dz * t;
  return Math.hypot(px - cx, pz - cz);
}

/**
 * Расстояние от точки до ОСИ секции (дуги постоянной кривизны) — используется
 * WorldStreamer.sectionAt() для определения секции игрока. Для прямых секций
 * (curvature≈0) эквивалентно distPointToSegment по хорде start-end; для дуги
 * расстояние до прямой хорды даёт систематическую ошибку в метры (стрела
 * прогиба ~ length*|curvature|/8), которой хватает, чтобы спутать соседние
 * секции у стыка.
 */
export function distPointToSectionAxis(px: number, pz: number, section: AxialFrame): number {
  const { curvature, yaw: yaw0, length } = section;
  if (Math.abs(curvature) < 1e-9) {
    const end = localToWorld(section, 0, length);
    return distPointToSegment(px, pz, section.start.x, section.start.z, end.x, end.z);
  }
  // Дуга — часть окружности радиуса 1/curvature с центром C; ближайшая точка
  // ПОЛНОЙ окружности к P лежит строго в направлении C->P, поэтому достаточно
  // найти угол этого направления (= курс дуги в искомой точке), перевести его
  // в параметр s и обрезать в границы [0, length] (если ближайшая точка полной
  // окружности вне дуги — ближайшая точка ДУГИ один из её концов, это и делает clamp).
  const R = 1 / curvature;
  const centerX = section.start.x + Math.cos(yaw0) * R;
  const centerZ = section.start.z - Math.sin(yaw0) * R;
  const vx = px - centerX;
  const vz = pz - centerZ;
  const yawAtNearest = Math.atan2(vz / R, -vx / R);
  let s = normAngle(yawAtNearest - yaw0) / curvature;
  s = clamp(s, 0, length);
  const nearest = localToWorld(section, 0, s);
  return Math.hypot(px - nearest.x, pz - nearest.z);
}

/**
 * Сэмплинг осевой линии секции точками через шаг stepLength — заготовка для
 * «сложного рельефа»: потребитель, желающий строить пол/стены по произвольной
 * ломаной оси, раскладывает её через эту функцию, не зная о curvature.
 */
export function sampleAxisPath(section: AxialFrame, stepLength: number): Vec2[] {
  return sampleBorderPath(section, 0, stepLength);
}

/**
 * Сэмплинг линии, параллельной оси на поперечном смещении localX, в мировых
 * координатах: точки с шагом stepLength по длине секции (включая оба конца).
 */
export function sampleBorderPath(section: AxialFrame, localX: number, stepLength: number): Vec2[] {
  const steps = Math.max(1, Math.round(section.length / Math.max(stepLength, 1e-6)));
  const points: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const z = (section.length * i) / steps;
    points.push(localToWorld(section, localX, z));
  }
  return points;
}
