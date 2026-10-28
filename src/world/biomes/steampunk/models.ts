import type { Mesh, Scene } from "@babylonjs/core";
import { mixRgb, rgb, scaleRgb, type ColorFn, type Rgb } from "../../../render/coloredMesh";
import { buildColoredPrimitives, type PrimitivePart } from "../../../render/coloredPrimitives";
import { perScene } from "../../../render/perScene";
import { MACHINE, PLAQUE, PORTHOLE, PIPES, TANK, TOWER, BOILER, WALL_GEAR } from "./layout";

/**
 * Модели стимпанк-цеха: напольный реквизит (ящики, бочки, малая машина, тележка с
 * углём), паровые машины у стен (двигатель с маховиком, котёл-топка,
 * теплолаборатория), латунные таблички, иллюминатор, трубы, шестерни, напорный бак,
 * вертикальный котёл и паровая башня (высокие укрытия), паровая решётка и облако
 * пара (укрытие-«куст»). Каждая — ОДИН меш из цветных примитивов
 * (render/coloredPrimitives), построенный один раз на сцену как шаблон. Секция
 * делает из шаблона instances (не создаёт геометрию заново) — так сборка чанка
 * остаётся дешёвой при стриминге.
 *
 * Система координат модели: начало — центр основания на полу (y = 0); «лицо»
 * (сторона, с которой на предмет смотрят) — к +Z, стена — к −Z. Для вещей,
 * висящих на стене, начало — центр на стене, лицо вперёд (+Z), толщина вдоль Z.
 */

const hex = rgb;

/** Лёгкое затемнение к полу: предмет «садится» на пол, не выглядит плоской заливкой. */
function tone(color: string, low = 0.82, topY = 1.6): ColorFn {
  const base = hex(color);
  return (_x, y) => scaleRgb(base, low + (1 - low) * Math.max(0, Math.min(1, y / topY)));
}

type V3 = readonly [number, number, number];

const box = (size: V3, pos: V3, color: Rgb | ColorFn, rot?: V3): PrimitivePart => ({ shape: "box", size, pos, color, rot });
const cyl = (diameter: number, height: number, pos: V3, color: Rgb | ColorFn, extra: { top?: number; rot?: V3; sides?: number } = {}): PrimitivePart => ({
  shape: "cylinder",
  diameter,
  height,
  diameterTop: extra.top,
  pos,
  color,
  rot: extra.rot,
  sides: extra.sides,
});
const ball = (diameter: number, pos: V3, color: Rgb | ColorFn): PrimitivePart => ({ shape: "sphere", diameter, pos, color });
const ring = (diameter: number, thickness: number, pos: V3, color: Rgb | ColorFn, rot?: V3, tessellation?: number): PrimitivePart => ({
  shape: "torus",
  diameter,
  thickness,
  pos,
  color,
  rot,
  tessellation,
});

const HALF_PI = Math.PI / 2;
/** Цилиндр лёжа вдоль X / вдоль Z. */
const ALONG_X: V3 = [0, 0, HALF_PI];
const ALONG_Z: V3 = [HALF_PI, 0, 0];
/** Тор, повёрнутый «лицом» к +Z (лежит в плоскости XY). */
const FACE_Z: V3 = [HALF_PI, 0, 0];

// ---------- Палитра ----------

const IRON = "#3a3d42";
const IRON_LIGHT = "#59606a";
const STEEL = "#8d98a6";
const SOOT = "#1c1a19";
const BRASS = "#c8923a";
const BRASS_DARK = "#8e6425";
const COPPER = "#b8663a";
const PATINA = "#58907e"; // позеленевшая медь: бак отличается от котла
const WOOD = "#8a5e36";
const WOOD_DARK = "#5a3d24";
const BRICK = "#8a4a38";
const COAL = "#2b2a2e";
const GLASS = "#a8d2cf";
const WATER = "#5f9fc4";
const AMBER = "#ffb23c";
const WHITE = "#ece8dc";
const RED = "#d83a3a";
const STEAM_LOW = "#bdb8ae";
const STEAM_HIGH = "#f6f4ee";

// ---------- Общие детали ----------

/**
 * Шестерня с зубьями, втулкой и «окнами». axis "z" — в плоскости XY (висит на стене,
 * стоит в раме), axis "y" — лёжа на полу или крышке (в плоскости XZ).
 */
function gear(center: V3, diameter: number, thick: number, color: Rgb | ColorFn, hub: Rgb | ColorFn, axis: "y" | "z", teeth = 10): PrimitivePart[] {
  const [cx, cy, cz] = center;
  const r = diameter / 2;
  const toothLen = diameter * 0.15;
  const toothW = ((2 * Math.PI * r) / teeth) * 0.5;
  const rt = r + toothLen / 2 - 0.01;
  const flat = axis === "y";
  const axisRot = flat ? undefined : ALONG_Z;
  const parts: PrimitivePart[] = [cyl(diameter, thick, center, color, { rot: axisRot, sides: 18 })];
  for (let i = 0; i < teeth; i++) {
    const a = (i * 2 * Math.PI) / teeth;
    parts.push(
      flat
        ? box([toothLen, thick, toothW], [cx + Math.cos(a) * rt, cy, cz - Math.sin(a) * rt], color, [0, a, 0])
        : box([toothLen, toothW, thick], [cx + Math.cos(a) * rt, cy + Math.sin(a) * rt, cz], color, [0, 0, a])
    );
  }
  // «Окна» между спицами и втулка (чуть толще диска — не мерцают на плоскости).
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const wx = Math.cos(a) * r * 0.55;
    const wy = Math.sin(a) * r * 0.55;
    parts.push(
      cyl(diameter * 0.2, thick + 0.012, flat ? [cx + wx, cy, cz - wy] : [cx + wx, cy + wy, cz], hex(SOOT), { rot: axisRot, sides: 10 })
    );
  }
  parts.push(cyl(diameter * 0.3, thick + 0.05, center, hub, { rot: axisRot, sides: 12 }));
  return parts;
}

/** Маховик: обод-тор, три диаметральные спицы, втулка. Плоскость XY. */
function flywheel(center: V3, diameter: number, color: Rgb | ColorFn, hub: Rgb | ColorFn): PrimitivePart[] {
  const rim = diameter * 0.09;
  const parts: PrimitivePart[] = [ring(diameter, rim, center, color, FACE_Z, 18)];
  for (let i = 0; i < 3; i++) parts.push(box([diameter - 0.04, 0.06, rim * 0.6], center, color, [0, 0, (i * Math.PI) / 3]));
  parts.push(cyl(diameter * 0.2, rim * 1.5, center, hub, { rot: ALONG_Z, sides: 12 }));
  return parts;
}

/** Манометр: латунный ободок, белый циферблат, красная стрелка; смотрит в +Z. */
function gauge(x: number, y: number, z: number, diameter: number, needleTurn = 0.7): PrimitivePart[] {
  return [
    cyl(diameter, 0.03, [x, y, z], hex(BRASS), { rot: ALONG_Z, sides: 14 }),
    cyl(diameter * 0.82, 0.034, [x, y, z + 0.004], hex(WHITE), { rot: ALONG_Z, sides: 14 }),
    box([diameter * 0.03, diameter * 0.34, 0.01], [x, y, z + 0.022], hex(RED), [0, 0, needleTurn]),
    cyl(diameter * 0.12, 0.016, [x, y, z + 0.022], hex("#222"), { rot: ALONG_Z, sides: 8 }),
  ];
}

/** Поворот точки (lx, lz) на yaw вокруг (x, z) — для частей, повёрнутых внутри одной модели. */
function around(x: number, z: number, lx: number, lz: number, yaw: number): [number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}

// ---------- Напольный реквизит ----------

function crate(x: number, y: number, z: number, size: number, yaw: number): PrimitivePart[] {
  const wood = tone(WOOD, 0.75, 1.3);
  const parts: PrimitivePart[] = [box([size, size, size], [x, y + size / 2, z], wood, [0, yaw, 0])];
  // Угловые стойки и две латунные планки сверху.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const [px, pz] = around(x, z, (sx * size) / 2, (sz * size) / 2, yaw);
      parts.push(box([0.07, size + 0.01, 0.07], [px, y + size / 2, pz], tone(WOOD_DARK, 0.75, 1.3), [0, yaw, 0]));
    }
  }
  parts.push(box([size + 0.01, 0.02, 0.07], [x, y + size + 0.005, z], hex(BRASS_DARK), [0, yaw, 0]));
  parts.push(box([0.07, 0.02, size + 0.01], [x, y + size + 0.005, z], hex(BRASS_DARK), [0, yaw, 0]));
  return parts;
}

function barrel(x: number, z: number, dia = 0.56, h = 0.82): PrimitivePart[] {
  const wood = tone(WOOD, 0.72, 1.0);
  const belly = (y: number): number => dia * (0.86 + (0.28 * (y < h / 2 ? y : h - y)) / h); // диаметр бочки на высоте y
  return [
    // Две усечённые «половины» дают пузатую бочку.
    cyl(dia * 0.86, h / 2, [x, h / 4, z], wood, { top: dia, sides: 12 }),
    cyl(dia, h / 2, [x, (3 * h) / 4, z], wood, { top: dia * 0.86, sides: 12 }),
    cyl(belly(0.15 * h) + 0.03, 0.04, [x, 0.15 * h, z], tone(IRON, 0.7, 1.0), { sides: 12 }),
    cyl(dia + 0.03, 0.04, [x, h / 2, z], tone(IRON, 0.7, 1.0), { sides: 12 }),
    cyl(belly(0.85 * h) + 0.03, 0.04, [x, 0.85 * h, z], tone(IRON, 0.7, 1.0), { sides: 12 }),
    cyl(dia * 0.84, 0.02, [x, h + 0.005, z], tone(WOOD_DARK, 0.8, 1.0), { sides: 12 }),
  ];
}

function buildProp(scene: Scene, variant: number): Mesh {
  let parts: PrimitivePart[];
  if (variant === 0) {
    // Ящики с шестерёнками: два на полу, один сверху, шестерня-запчасть лёжа.
    parts = [
      ...crate(-0.4, 0, -0.1, 0.7, 0.1),
      ...crate(0.35, 0, 0.1, 0.6, -0.2),
      ...crate(-0.4, 0.7, -0.1, 0.4, 0.5),
      ...gear([0.35, 0.62, 0.1], 0.42, 0.05, hex(BRASS), hex(BRASS_DARK), "y", 9),
    ];
  } else if (variant === 1) {
    // Бочки: три стоят, у одной латунный кран.
    parts = [
      ...barrel(-0.4, -0.15),
      ...barrel(0.12, -0.25, 0.52, 0.78),
      ...barrel(0.45, 0.2),
      cyl(0.05, 0.14, [0.76, 0.3, 0.2], hex(BRASS), { rot: ALONG_X }),
      box([0.03, 0.1, 0.03], [0.8, 0.38, 0.2], hex(BRASS_DARK)),
    ];
  } else if (variant === 2) {
    // Малая паровая машина на плите: цилиндр, шток, маховик, труба.
    const y = 0.62;
    parts = [
      box([1.4, 0.12, 0.8], [0, 0.06, 0], hex(IRON)),
      box([0.12, 0.3, 0.4], [-0.55, 0.27, 0], hex(IRON_LIGHT)),
      box([0.12, 0.3, 0.4], [-0.05, 0.27, 0], hex(IRON_LIGHT)),
      cyl(0.4, 0.8, [-0.3, y, 0], tone(COPPER, 0.8, 1.1), { rot: ALONG_X, sides: 14 }),
      cyl(0.46, 0.06, [-0.7, y, 0], hex(BRASS), { rot: ALONG_X, sides: 14 }),
      cyl(0.06, 0.45, [0.3, y, 0.05], hex(STEEL), { rot: ALONG_X }),
      ...flywheel([0.42, y, 0.02], 0.8, tone(IRON, 0.8, 1.1), hex(BRASS)),
      cyl(0.07, 0.07, [0.62, y + 0.18, 0.1], hex(BRASS), { rot: ALONG_Z }),
      box([0.34, 0.05, 0.05], [0.4, y + 0.1, 0.13], hex(STEEL), [0, 0, 0.3]),
      ball(0.22, [-0.3, y + 0.28, 0], tone(COPPER, 0.85, 1.1)),
      cyl(0.1, 0.22, [-0.3, y + 0.46, 0], hex(IRON), { sides: 8 }),
      ...gauge(-0.5, y + 0.05, 0.22, 0.16),
    ];
  } else {
    // Тележка с углём: короб, колёса на осях, куча угля, лопата.
    parts = [
      box([1.3, 0.4, 0.75], [0, 0.55, 0], tone(WOOD_DARK, 0.75, 1.1)),
      box([1.34, 0.05, 0.79], [0, 0.37, 0], hex(IRON)),
      box([1.34, 0.05, 0.79], [0, 0.74, 0], hex(IRON)),
      ...[-0.45, 0.45].flatMap((wx) => [
        cyl(0.06, 0.95, [wx, 0.28, 0], hex(STEEL), { rot: ALONG_Z }),
        ...[-0.42, 0.42].flatMap((wz) => [
          cyl(0.56, 0.08, [wx, 0.28, wz], hex(IRON), { rot: ALONG_Z, sides: 12 }),
          cyl(0.16, 0.1, [wx, 0.28, wz], hex(BRASS), { rot: ALONG_Z, sides: 8 }),
        ]),
      ]),
      ball(0.5, [-0.3, 0.84, 0.05], tone(COAL, 0.8, 1.2)),
      ball(0.55, [0.1, 0.9, -0.05], tone(COAL, 0.8, 1.2)),
      ball(0.45, [0.4, 0.82, 0.1], tone(COAL, 0.8, 1.2)),
      ball(0.4, [-0.05, 0.82, 0.2], hex("#3f3f46")),
      ball(0.16, [0.2, 1.1, 0.05], hex("#4a4a52")),
      cyl(0.04, 0.55, [0.12, 0.96, 0.15], hex(WOOD), { rot: [0, 0, 0.5] }),
      box([0.2, 0.03, 0.18], [0.25, 0.74, 0.15], hex(STEEL), [0, 0, 0.5]),
    ];
  }
  return buildColoredPrimitives(`steampunk_prop_${variant}`, parts, scene);
}

// ---------- Машины у стен ----------

function buildMachine(scene: Scene, variant: number): Mesh {
  const len = MACHINE.len;
  let parts: PrimitivePart[];

  if (variant === 0) {
    // Паровой двигатель: цилиндр с золотниковой коробкой, шток и шатун, маховик, регулятор.
    const T = 0.68;
    parts = [
      box([len - 0.1, 0.12, 0.85], [0, 0.06, -0.03], hex(SOOT)),
      box([len - 0.2, 0.5, 0.8], [0, 0.37, -0.03], tone(IRON, 0.75, 1.0)),
      box([len - 0.1, 0.06, 0.9], [0, T - 0.03, 0], tone(IRON_LIGHT, 0.85, 1.2)),
      // Цилиндр с крышками на двух седлах.
      box([0.12, 0.3, 0.4], [-0.9, T + 0.15, 0.02], hex(IRON_LIGHT)),
      box([0.12, 0.3, 0.4], [-0.2, T + 0.15, 0.02], hex(IRON_LIGHT)),
      cyl(0.46, 1.0, [-0.55, T + 0.3, 0.02], tone(COPPER, 0.8, 1.6), { rot: ALONG_X, sides: 16 }),
      cyl(0.52, 0.07, [-1.06, T + 0.3, 0.02], hex(BRASS), { rot: ALONG_X, sides: 16 }),
      cyl(0.5, 0.05, [-0.04, T + 0.3, 0.02], hex(BRASS), { rot: ALONG_X, sides: 16 }),
      // Золотниковая коробка сверху и паровая труба.
      box([0.5, 0.2, 0.3], [-0.55, T + 0.63, 0.02], tone(COPPER, 0.85, 1.6)),
      cyl(0.1, 0.5, [-0.55, T + 0.98, 0.02], hex(BRASS), { sides: 8 }),
      cyl(0.16, 0.05, [-0.55, T + 1.25, 0.02], hex(BRASS_DARK), { sides: 8 }),
      // Шток, ползун, шатун.
      cyl(0.07, 0.5, [0.25, T + 0.3, 0.02], hex(STEEL), { rot: ALONG_X }),
      box([0.6, 0.08, 0.18], [0.35, T + 0.18, 0.02], hex(IRON)),
      ...flywheel([0.74, T + 0.45, 0.02], 1.1, tone(IRON, 0.8, 1.8), hex(BRASS)),
      cyl(0.08, 0.08, [1.07, T + 0.67, 0.1], hex(BRASS), { rot: ALONG_Z }),
      box([0.65, 0.06, 0.05], [0.8, T + 0.5, 0.14], hex(STEEL), [0, 0, 0.6]),
      // Центробежный регулятор: стержень и два шара на тягах.
      cyl(0.04, 0.55, [0.05, T + 0.28, -0.22], hex(STEEL)),
      ball(0.1, [-0.07, T + 0.5, -0.22], hex(BRASS)),
      ball(0.1, [0.17, T + 0.5, -0.22], hex(BRASS)),
      ball(0.08, [0.05, T + 0.58, -0.22], hex(BRASS_DARK)),
      ...gauge(-0.85, T + 0.66, 0.2, 0.24, -0.6),
    ];
  } else if (variant === 1) {
    // Котёл-топка: кирпичная печь с огненным окошком, горизонтальный барабан с поясами, дымовая труба, купол, водомерное стекло.
    const T = 0.6;
    const R = 0.43; // радиус барабана: пояса и заглушка не должны выходить за заднюю стенку (стена на z = −MACHINE.depth/2)
    const cy = T + 0.5;
    const z0 = -0.03;
    parts = [
      box([len - 0.2, T, 0.85], [0, T / 2, -0.03], tone(BRICK, 0.7, 1.0)),
      box([len - 0.1, 0.06, 0.9], [0, 0.03, 0], hex(SOOT)),
      // Топка: железная дверца с раскалённым окошком.
      box([0.7, 0.42, 0.05], [-0.7, 0.3, 0.41], hex(IRON)),
      box([0.46, 0.22, 0.02], [-0.7, 0.32, 0.44], hex(AMBER)),
      box([0.04, 0.16, 0.04], [-0.42, 0.3, 0.45], hex(BRASS)),
      // Барабан котла на кирпичном основании.
      cyl(R * 2, 2.2, [0.1, cy, z0], tone(COPPER, 0.8, 1.7), { rot: ALONG_X, sides: 18 }),
      ...[-0.7, -0.1, 0.5, 1.0].map((bx) => cyl(R * 2 + 0.04, 0.06, [bx, cy, z0], hex(BRASS), { rot: ALONG_X, sides: 18 })),
      cyl(R * 2 + 0.06, 0.08, [-1.0, cy, z0], hex(IRON), { rot: ALONG_X, sides: 18 }),
      // Дымовая труба, купол и предохранительный клапан.
      cyl(0.26, 0.6, [-0.85, cy + R + 0.3, z0], tone(IRON, 0.8, 2.2), { sides: 10 }),
      cyl(0.34, 0.06, [-0.85, cy + R + 0.6, z0], hex(BRASS), { sides: 10 }),
      cyl(0.38, 0.28, [0.5, cy + R + 0.12, z0], tone(COPPER, 0.85, 2.0), { top: 0.28, sides: 12 }),
      cyl(0.07, 0.2, [0.5, cy + R + 0.36, z0], hex(BRASS), { sides: 8 }),
      // Манометр, водомерное стекло с латунными колпаками, вентиль (на передней поверхности барабана, z0 + R ≈ 0.40).
      ...gauge(-0.25, cy, 0.42, 0.28, 0.9),
      cyl(0.06, 0.42, [0.45, cy, 0.43], hex(WATER), { sides: 8 }),
      cyl(0.09, 0.06, [0.45, cy + 0.23, 0.43], hex(BRASS), { sides: 8 }),
      cyl(0.09, 0.06, [0.45, cy - 0.23, 0.43], hex(BRASS), { sides: 8 }),
      ring(0.2, 0.035, [0.9, cy, 0.42], hex(RED), FACE_Z, 10),
      cyl(0.04, 0.06, [0.9, cy, 0.4], hex(BRASS_DARK), { rot: ALONG_Z }),
    ];
  } else {
    // Теплолаборатория: горелка с колбой, термометр, калориметр, стрелочный манометр, малый двигатель Стирлинга.
    const T = 0.84;
    parts = [
      box([len - 0.1, T - 0.06, 0.85], [0, (T - 0.06) / 2, -0.03], tone(WOOD, 0.72, 1.0)),
      box([len, 0.06, 0.9], [0, T - 0.03, 0], hex(IRON_LIGHT)),
      ...[-1, 1].flatMap((sx) => [
        box([1.12, 0.52, 0.02], [sx * 0.62, 0.4, 0.42], tone("#6c4a2c", 0.8, 1.0)),
        box([0.03, 0.12, 0.03], [sx * 0.62 - sx * 0.46, 0.46, 0.44], hex(BRASS)),
      ]),
      // Спиртовка, треножник и колба с водой и термометром.
      cyl(0.16, 0.1, [-0.95, T + 0.05, 0.05], hex(BRASS), { sides: 10 }),
      cyl(0.11, 0.13, [-0.95, T + 0.16, 0.05], hex(AMBER), { top: 0, sides: 8 }),
      ...[0, 1, 2].map((i) => {
        const a = (i * 2 * Math.PI) / 3;
        return box([0.025, 0.3, 0.025], [-0.95 + Math.cos(a) * 0.12, T + 0.15, 0.05 + Math.sin(a) * 0.12], hex(IRON), [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3]);
      }),
      ring(0.3, 0.03, [-0.95, T + 0.3, 0.05], hex(IRON), undefined, 10),
      ball(0.36, [-0.95, T + 0.48, 0.05], hex(GLASS)),
      ball(0.3, [-0.95, T + 0.45, 0.05], hex(WATER)),
      cyl(0.11, 0.22, [-0.95, T + 0.73, 0.05], hex(GLASS), { sides: 8 }),
      cyl(0.02, 0.45, [-0.9, T + 0.78, 0.05], hex(RED), { rot: [0, 0, -0.12] }),
      // Термометр на подставке: стеклянная трубка, красный столбик, шарик.
      box([0.14, 0.04, 0.14], [-0.35, T + 0.02, 0], hex(IRON)),
      cyl(0.045, 0.75, [-0.35, T + 0.42, 0], hex(GLASS), { sides: 8 }),
      cyl(0.022, 0.44, [-0.35, T + 0.24, 0], hex(RED), { sides: 8 }),
      ball(0.09, [-0.35, T + 0.08, 0], hex(RED)),
      // Калориметр: медный стакан с крышкой и мешалкой.
      cyl(0.34, 0.36, [0.15, T + 0.18, 0], tone(COPPER, 0.82, 1.4), { sides: 12 }),
      cyl(0.36, 0.03, [0.15, T + 0.375, 0], hex(BRASS), { sides: 12 }),
      cyl(0.02, 0.3, [0.2, T + 0.54, 0], hex(STEEL)),
      ball(0.06, [0.2, T + 0.7, 0], hex(BRASS_DARK)),
      // Большой манометр на стойке.
      cyl(0.06, 0.5, [0.7, T + 0.25, -0.1], hex(BRASS), { sides: 8 }),
      box([0.22, 0.04, 0.22], [0.7, T + 0.02, -0.1], hex(IRON)),
      ...gauge(0.7, T + 0.6, -0.08, 0.46, 0.5),
      // Двигатель Стирлинга: горячий цилиндр, холодный цилиндр, маховичок.
      box([0.5, 0.05, 0.3], [1.05, T + 0.025, 0], hex(IRON)),
      cyl(0.16, 0.3, [0.95, T + 0.2, 0], tone(COPPER, 0.8, 1.4), { sides: 10 }),
      cyl(0.14, 0.24, [1.15, T + 0.17, 0], hex(STEEL), { sides: 10 }),
      ...flywheel([1.05, T + 0.45, 0.13], 0.3, hex(IRON), hex(BRASS)),
    ];
  }
  return buildColoredPrimitives(`steampunk_machine_${variant}`, parts, scene);
}

// ---------- Стена: табличка, иллюминатор, трубы, шестерни ----------

function buildPlaque(scene: Scene): Mesh {
  const { len, h, y, thickness: th } = PLAQUE;
  const brass = tone(BRASS, 0.8, 2.4);
  const parts: PrimitivePart[] = [
    box([len, h, th], [0, y, 0], hex(WOOD_DARK)),
    box([len - 0.2, h - 0.2, 0.02], [0, y, th / 2], hex("#1c1714")),
    box([len, 0.08, 0.05], [0, y + h / 2 - 0.04, th / 2 + 0.005], brass),
    box([len, 0.08, 0.05], [0, y - h / 2 + 0.04, th / 2 + 0.005], brass),
    box([0.08, h, 0.05], [-len / 2 + 0.04, y, th / 2 + 0.005], brass),
    box([0.08, h, 0.05], [len / 2 - 0.04, y, th / 2 + 0.005], brass),
    // Заклёпки по углам и латунная полочка снизу.
    ...[-1, 1].flatMap((sx) =>
      [-1, 1].map((sy) => cyl(0.08, 0.04, [sx * (len / 2 - 0.04), y + sy * (h / 2 - 0.04), th / 2 + 0.04], hex(BRASS_DARK), { rot: ALONG_Z, sides: 8 }))
    ),
    box([len - 0.4, 0.05, 0.12], [0, y - h / 2 - 0.02, th / 2 + 0.05], hex(BRASS_DARK)),
    ...gauge(-0.8, y - h / 2 + 0.15, th / 2 + 0.07, 0.2, 0.2),
    ...gauge(0.8, y - h / 2 + 0.15, th / 2 + 0.07, 0.2, -0.4),
  ];
  return buildColoredPrimitives("steampunk_plaque", parts, scene);
}

function buildPorthole(scene: Scene): Mesh {
  const { d, y, thickness: th } = PORTHOLE;
  const glass: ColorFn = (x, py) => {
    const t = Math.max(0, Math.min(1, (py - (y - d / 2)) / d));
    return mixRgb(hex("#6f9aa6"), hex("#cfe6e8"), t * 0.8 + Math.max(0, x) * 0.1);
  };
  const parts: PrimitivePart[] = [
    cyl(d + 0.28, 0.05, [0, y, -0.02], hex(IRON), { rot: ALONG_Z, sides: 18 }),
    cyl(d - 0.1, 0.03, [0, y, 0], glass, { rot: ALONG_Z, sides: 20 }),
    ring(d, th, [0, y, 0], hex(BRASS), FACE_Z, 20),
    box([d - 0.1, 0.035, 0.02], [0, y, 0.015], hex(BRASS_DARK)),
    box([0.035, d - 0.1, 0.02], [0, y, 0.015], hex(BRASS_DARK)),
    // Болты по ободу.
    ...Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4 + Math.PI / 8;
      return cyl(0.06, 0.05, [Math.cos(a) * (d / 2 + 0.1), y + Math.sin(a) * (d / 2 + 0.1), 0.02], hex(BRASS_DARK), { rot: ALONG_Z, sides: 6 });
    }),
  ];
  return buildColoredPrimitives("steampunk_porthole", parts, scene);
}

function buildPipes(scene: Scene): Mesh {
  const len = PIPES.len;
  const parts: PrimitivePart[] = [
    cyl(PIPES.thickness - 0.02, len, [0, 2.0, 0], tone(COPPER, 0.8, 2.6), { rot: ALONG_X, sides: 12 }),
    cyl(0.14, len, [0, 2.3, 0], tone(BRASS, 0.8, 2.6), { rot: ALONG_X, sides: 12 }),
    // Фланцы, перемычка между трубами, скобы на стене.
    ...[-1.1, -0.4, 0.3, 1.0].flatMap((x) => [
      cyl(0.27, 0.05, [x, 2.0, 0], hex(IRON), { rot: ALONG_X, sides: 12 }),
      cyl(0.21, 0.05, [x + 0.05, 2.3, 0], hex(IRON), { rot: ALONG_X, sides: 12 }),
    ]),
    cyl(0.1, 0.32, [-0.75, 2.15, 0], hex(COPPER), { sides: 8 }),
    ...[-1.0, 1.0].map((x) => box([0.07, 0.5, 0.05], [x, 2.15, -0.07], hex(IRON))),
    ...gauge(0.55, 2.0, 0.12, 0.22, 0.6),
    ring(0.2, 0.035, [0.1, 2.3, 0.09], hex(RED), FACE_Z, 10),
    cyl(0.03, 0.12, [0.1, 2.3, 0.05], hex(BRASS_DARK), { rot: ALONG_Z, sides: 6 }),
  ];
  return buildColoredPrimitives("steampunk_pipes", parts, scene);
}

function buildWallGear(scene: Scene): Mesh {
  const { d, y, thickness: th } = WALL_GEAR;
  const body = tone(BRASS, 0.78, 2.7);
  const parts: PrimitivePart[] = [
    // Шестерни зацеплены, но лежат в чуть разных плоскостях: общая грань мерцала бы (z-fighting).
    ...gear([0.35, y, 0], d, th, body, hex(BRASS_DARK), "z", 12),
    ...gear([-0.5, y - 0.4, 0.03], d * 0.54, th, tone(COPPER, 0.78, 2.7), hex(BRASS_DARK), "z", 8),
    ...gear([-0.95, y + 0.1, 0.06], d * 0.3, th, tone(IRON_LIGHT, 0.8, 2.7), hex(BRASS), "z", 6),
  ];
  return buildColoredPrimitives("steampunk_wall_gear", parts, scene);
}

// ---------- Бак ----------

function buildTank(scene: Scene): Mesh {
  const { h } = TANK;
  const copper = tone(PATINA, 0.78, h);
  const parts: PrimitivePart[] = [
    cyl(1.1, 0.2, [0, 0.1, 0], hex(IRON), { sides: 16 }),
    cyl(1.0, 1.75, [0, 0.2 + 0.875, 0], copper, { sides: 16 }),
    ...[0.5, 1.1, 1.7].map((by) => cyl(1.04, 0.07, [0, by, 0], hex(BRASS), { sides: 16 })),
    cyl(1.0, 0.25, [0, 2.075, 0], copper, { top: 0.5, sides: 16 }),
    cyl(0.5, 0.1, [0, 2.25, 0], hex(BRASS), { sides: 12 }),
    cyl(0.14, 0.15, [0, 2.33, 0], hex(IRON), { sides: 8 }),
    // Манометр и водомерное стекло спереди, труба в стену.
    ...gauge(0, 1.5, 0.5, 0.3, 0.8),
    cyl(0.06, 0.9, [0.38, 1.0, 0.45], hex(WATER), { sides: 8 }),
    cyl(0.1, 0.06, [0.38, 1.47, 0.45], hex(BRASS), { sides: 8 }),
    cyl(0.1, 0.06, [0.38, 0.55, 0.45], hex(BRASS), { sides: 8 }),
    cyl(0.12, 0.4, [0, 0.55, -0.35], hex(BRASS_DARK), { rot: ALONG_Z, sides: 8 }), // от бака до стены (z = −TANK.depth/2)
  ];
  return buildColoredPrimitives("steampunk_tank", parts, scene);
}

// ---------- Укрытия: котёл и паровая башня ----------

/** Вертикальный паровой котёл: широкий корпус с поясами, купол, труба, топочная дверца, манометр, водомерное стекло. */
function buildBoiler(scene: Scene): Mesh {
  const D = BOILER.diameter;
  const body = tone(COPPER, 0.78, BOILER.h);
  const parts: PrimitivePart[] = [
    cyl(D + 0.15, 0.25, [0, 0.125, 0], hex(IRON), { sides: 16 }),
    cyl(D, 1.95, [0, 0.25 + 0.975, 0], body, { sides: 16 }),
    ...[0.6, 1.3, 1.95].map((by) => cyl(D + 0.05, 0.07, [0, by, 0], hex(BRASS), { sides: 16 })),
    cyl(D, 0.4, [0, 2.4, 0], body, { top: 0.55, sides: 16 }),
    cyl(0.28, 0.35, [0, 2.775, 0], tone(IRON, 0.8, BOILER.h), { top: 0.24, sides: 10 }),
    cyl(0.36, 0.06, [0, 2.93, 0], hex(BRASS), { sides: 10 }),
    // Топочная дверца с огненным окошком.
    box([0.5, 0.4, 0.06], [0, 0.5, D / 2 + 0.01], hex(IRON)),
    box([0.3, 0.2, 0.02], [0, 0.52, D / 2 + 0.045], hex(AMBER)),
    box([0.04, 0.14, 0.04], [0.19, 0.5, D / 2 + 0.06], hex(BRASS)),
    ...gauge(0, 1.6, D / 2 + 0.03, 0.32, 0.7),
    // Водомерное стекло сбоку.
    cyl(0.06, 0.8, [0.42, 1.1, 0.52], hex(WATER), { sides: 8 }),
    cyl(0.1, 0.06, [0.42, 1.52, 0.52], hex(BRASS), { sides: 8 }),
    cyl(0.1, 0.06, [0.42, 0.68, 0.52], hex(BRASS), { sides: 8 }),
  ];
  return buildColoredPrimitives("steampunk_boiler", parts, scene);
}

/** Паровая башня: стальной каркас с зацепленными шестернями, горизонтальными тягами, манометром и лампой наверху. */
function buildTower(scene: Scene): Mesh {
  const { len, depth, h } = TOWER;
  const frame = tone(IRON_LIGHT, 0.78, h);
  const parts: PrimitivePart[] = [
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box([0.08, h, 0.08], [sx * (len / 2 - 0.04), h / 2, sz * (depth / 2 - 0.04)], frame))),
    box([len, 0.12, depth], [0, 0.06, 0], hex(SOOT)),
    box([len, 0.1, depth], [0, h - 0.05, 0], tone(IRON, 0.85, h)),
    box([len - 0.1, h - 0.2, 0.03], [0, h / 2, -depth / 2 + 0.02], tone("#3b3e44", 0.78, h)),
    ...[0.9, 1.7].flatMap((ty) => [
      box([len, 0.05, 0.05], [0, ty, depth / 2 - 0.04], frame),
      box([len, 0.05, 0.05], [0, ty, -depth / 2 + 0.04], frame),
    ]),
    // Зацепленные шестерни в раме (одна плоскость XY).
    ...gear([-0.3, 0.95, 0], 0.8, 0.08, tone(BRASS, 0.78, h), hex(BRASS_DARK), "z", 10),
    ...gear([0.38, 1.5, 0.03], 0.7, 0.08, tone(COPPER, 0.78, h), hex(BRASS_DARK), "z", 9),
    ...gear([-0.28, 1.85, -0.03], 0.5, 0.08, tone(BRASS, 0.78, h), hex(BRASS_DARK), "z", 7),
    ...gauge(0.45, 0.55, depth / 2 + 0.01, 0.26, 0.5),
    // Колпак и лампа на вершине.
    cyl(0.2, 0.12, [0, h + 0.06, 0], hex(BRASS), { sides: 10 }),
    ball(0.22, [0, h + 0.22, 0], hex(AMBER)),
  ];
  return buildColoredPrimitives("steampunk_tower", parts, scene);
}

// ---------- Паровая решётка и облако пара (укрытие-«куст») ----------

/** Решётка в полу: низ на полу, облако садится сверху (см. buildSteamCloud). */
function buildVent(scene: Scene): Mesh {
  const parts: PrimitivePart[] = [
    cyl(1.2, 0.06, [0, 0.03, 0], hex(IRON), { sides: 14 }),
    ring(1.05, 0.1, [0, 0.07, 0], hex(BRASS), undefined, 14),
    cyl(0.86, 0.06, [0, 0.05, 0], hex(SOOT), { sides: 14 }),
    ...[-0.3, -0.15, 0, 0.15, 0.3].map((bz) => box([0.8 - Math.abs(bz) * 0.5, 0.02, 0.04], [0, 0.085, bz], hex(BRASS_DARK))),
  ];
  return buildColoredPrimitives("steampunk_vent", parts, scene);
}

/**
 * Облако пара для куста-укрытия: клубы внутри сферы-габарита радиусом 1.2 (как у
 * куста в поле, BUSH_ENVELOPE_RADIUS) с центром в начале координат; пол — на y = −1.2,
 * шлейф пара сужается к решётке.
 */
function buildSteamCloud(scene: Scene): Mesh {
  const color: ColorFn = (_x, y) => mixRgb(hex(STEAM_LOW), hex(STEAM_HIGH), Math.max(0, Math.min(1, (y + 1.2) / 2.2)));
  const parts: PrimitivePart[] = [
    // Шапка из клубов внутри сферы-габарита…
    ball(1.15, [0.0, 0.05, 0], color),
    ball(0.9, [0.5, 0.2, 0.2], color),
    ball(0.85, [-0.5, 0.15, 0.1], color),
    ball(0.85, [0.1, 0.5, -0.4], color),
    ball(0.8, [-0.15, 0.55, 0.35], color),
    ball(0.75, [0.35, -0.3, -0.4], color),
    ball(0.7, [-0.35, -0.3, 0.4], color),
    // …и шлейф, сужающийся к решётке: пар не висит над полом, а вырывается из неё.
    ball(0.7, [0.05, -0.62, 0.0], color),
    ball(0.5, [-0.05, -0.95, 0.05], color),
    ball(0.4, [0.0, -1.0, 0.0], color),
  ];
  return buildColoredPrimitives("steampunk_steam", parts, scene);
}

// ---------- Набор шаблонов на сцену ----------

export interface SteampunkKit {
  props: Mesh[];
  machines: Mesh[];
  plaque: Mesh;
  porthole: Mesh;
  pipes: Mesh;
  wallGear: Mesh;
  tank: Mesh;
  boiler: Mesh;
  tower: Mesh;
  vent: Mesh;
  steam: Mesh;
}

/** Все шаблоны цеха: строятся один раз на сцену, выключены (рисуются только их instances/клоны). */
export const steampunkKit = perScene((scene): SteampunkKit => {
  const kit: SteampunkKit = {
    props: [0, 1, 2, 3].map((v) => buildProp(scene, v)),
    machines: [0, 1, 2].map((v) => buildMachine(scene, v)),
    plaque: buildPlaque(scene),
    porthole: buildPorthole(scene),
    pipes: buildPipes(scene),
    wallGear: buildWallGear(scene),
    tank: buildTank(scene),
    boiler: buildBoiler(scene),
    tower: buildTower(scene),
    vent: buildVent(scene),
    steam: buildSteamCloud(scene),
  };
  const all = [...kit.props, ...kit.machines, kit.plaque, kit.porthole, kit.pipes, kit.wallGear, kit.tank, kit.boiler, kit.tower, kit.vent, kit.steam];
  for (const mesh of all) mesh.setEnabled(false);
  return kit;
});
