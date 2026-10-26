import type { Mesh, Scene } from "@babylonjs/core";
import { rgb, scaleRgb, type ColorFn, type Rgb } from "../../../render/coloredMesh";
import { buildColoredPrimitives, type PrimitivePart } from "../../../render/coloredPrimitives";
import { perScene } from "../../../render/perScene";
import { hash01 } from "../../../render/noise";
import { BENCH, BOARD, CABINET, DESK, POSTER, SHELF, WINDOW } from "./layout";

/**
 * Модели школьного класса: парты и стулья, лабораторные столы с электрическими
 * установками, доски, окна, плакаты, стеллажи, шкафы, горшок. Каждая — ОДИН меш из
 * цветных примитивов (render/coloredPrimitives), построенный один раз на сцену
 * как шаблон. Секция делает из шаблона instances (не создаёт геометрию заново) —
 * так сборка чанка остаётся дешёвой при стриминге.
 *
 * Система координат модели: начало — центр основания на полу (y = 0); «лицо»
 * (сторона, с которой на мебель смотрят) — к +Z, спинка/стена — к −Z. Для вещей,
 * висящих на стене, начало — центр на стене, лицо вперёд (+Z), толщина вдоль Z.
 */

const hex = rgb;

/** Лёгкое затемнение к полу: мебель «садится» на пол, не выглядит плоской заливкой. */
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
const ring = (diameter: number, thickness: number, pos: V3, color: Rgb | ColorFn): PrimitivePart => ({ shape: "torus", diameter, thickness, pos, color });

const HALF_PI = Math.PI / 2;
/** Цилиндр лёжа вдоль X / вдоль Z. */
const ALONG_X: V3 = [0, 0, HALF_PI];
const ALONG_Z: V3 = [HALF_PI, 0, 0];

// ---------- Палитра ----------

const WOOD = "#d9ad6c";
const WOOD_DARK = "#9a7a50";
const METAL = "#3d434c";
const STEEL = "#6f7e8c";
const EPOXY = "#2c3036";
const COPPER = "#b8733a";
const RED = "#d83a3a";
const BLUE = "#3a5fd9";
const WHITE = "#ececea";
const BLACK = "#15171a";
const CHAIR_COLORS = ["#3e74c4", "#e08a3c", "#3f9e6b"] as const;
const BOOK_COLORS = ["#c0453a", "#3e74c4", "#e0b43c", "#3f9e6b", "#8a5fc0", "#d9d2c0"] as const;

// ---------- Парта ----------

function chair(x: number, z: number, color: string, turn: number): PrimitivePart[] {
  // Стул — в собственной системе (спинка к −Z), потом повёрнут на `turn` вокруг своего центра.
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const at = (lx: number, y: number, lz: number): V3 => [x + lx * c + lz * s, y, z - lx * s + lz * c];
  const seatColor = tone(color, 0.78, 0.9);
  return [
    box([0.42, 0.04, 0.4], at(0, 0.44, 0), seatColor, [0, turn, 0]),
    box([0.42, 0.34, 0.04], at(0, 0.7, -0.2), seatColor, [0, turn, 0]),
    ...[-0.17, 0.17].flatMap((lx) =>
      [-0.15, 0.17].map((lz) => box([0.03, 0.42, 0.03], at(lx, 0.21, lz), tone(METAL, 0.7, 0.5), [0, turn, 0]))
    ),
  ];
}

function buildDesk(scene: Scene, variant: number): Mesh {
  const chairColor = CHAIR_COLORS[variant % CHAIR_COLORS.length];
  const parts: PrimitivePart[] = [
    box([DESK.w, 0.05, DESK.d], [0, DESK.h - 0.025, 0], hex(WOOD)),
    // Боковые рамы и перекладина.
    ...[-1, 1].map((sx) => box([0.05, DESK.h - 0.05, DESK.d - 0.1], [sx * (DESK.w / 2 - 0.1), (DESK.h - 0.05) / 2, 0], tone(METAL, 0.7, 0.8))),
    box([DESK.w - 0.3, 0.05, 0.04], [0, 0.5, -0.22], tone(METAL, 0.7, 0.8)),
    // Тетради на столе — у каждого вида свои.
    ...(variant === 0
      ? [box([0.3, 0.02, 0.22], [-0.36, DESK.h + 0.01, 0.0], hex("#3e74c4"), [0, 0.18, 0]), box([0.2, 0.02, 0.16], [0.4, DESK.h + 0.01, 0.1], hex("#d9d2c0"), [0, -0.1, 0])]
      : variant === 1
        ? [box([0.28, 0.025, 0.2], [0.35, DESK.h + 0.0125, 0.0], hex("#c0453a"), [0, 0.3, 0])]
        : []),
  ];
  // Стулья: задвинуты / один выдвинут / оба выдвинуты и развёрнуты.
  const pull = variant === 0 ? [0, 0] : variant === 1 ? [0, 0.32] : [0.25, 0.4];
  const turn = variant === 2 ? [0.3, -0.35] : [0, 0.12];
  parts.push(...chair(-0.38, -0.55 - pull[0], chairColor, turn[0]), ...chair(0.38, -0.55 - pull[1], chairColor, turn[1]));
  return buildColoredPrimitives(`classroom_desk_${variant}`, parts, scene);
}

// ---------- Лабораторные столы ----------

/** Основание стола с дверцами и чёрной столешницей; apparatus ставится на y = BENCH.h. */
function benchBase(): PrimitivePart[] {
  const w = BENCH.len;
  const d = BENCH.depth;
  return [
    box([w - 0.1, BENCH.h - 0.07, d - 0.1], [0, (BENCH.h - 0.07) / 2, -0.02], tone(WOOD_DARK, 0.75, 0.9)),
    box([w, 0.06, d], [0, BENCH.h - 0.03, 0], hex(EPOXY)),
    // Дверцы с ручками на лицевой стороне.
    ...[-1, 1].flatMap((sx) => [
      box([1.14, 0.64, 0.02], [sx * 0.62, 0.42, d / 2 - 0.045], tone("#b49264", 0.8, 0.9)),
      box([0.02, 0.12, 0.03], [sx * 0.62 - sx * 0.46, 0.5, d / 2 - 0.03], hex(METAL)),
    ]),
    box([w - 0.1, 0.07, d - 0.1], [0, 0.035, -0.02], hex("#2a2420")), // цоколь
  ];
}

const TOP = BENCH.h; // y столешницы

/** Вид 0: сборка электрической цепи — источник тока, реостат, амперметр, вольтметр, лампа, ключ, провода. */
function circuitSet(): PrimitivePart[] {
  const t = TOP;
  return [
    // Источник тока с клеммами.
    box([0.46, 0.22, 0.3], [-0.95, t + 0.11, -0.08], hex("#454c56")),
    box([0.34, 0.1, 0.02], [-0.95, t + 0.11, 0.08], hex("#8d98a6")),
    cyl(0.05, 0.05, [-1.05, t + 0.245, 0.0], hex(RED)),
    cyl(0.05, 0.05, [-0.85, t + 0.245, 0.0], hex(BLACK)),
    // Реостат: керамический цилиндр с медной обмоткой на стойках.
    cyl(0.1, 0.62, [-0.28, t + 0.15, -0.05], hex("#d9c7a3"), { rot: ALONG_X }),
    ...[-0.24, -0.12, 0, 0.12, 0.24].map((dx) => cyl(0.118, 0.045, [-0.28 + dx, t + 0.15, -0.05], hex(COPPER), { rot: ALONG_X })),
    box([0.04, 0.2, 0.16], [-0.62, t + 0.1, -0.05], hex(METAL)),
    box([0.04, 0.2, 0.16], [0.06, t + 0.1, -0.05], hex(METAL)),
    box([0.5, 0.02, 0.03], [-0.28, t + 0.235, -0.05], hex("#b9c1cb")),
    // Амперметр и вольтметр: белые корпуса с чёрным циферблатом и стрелкой.
    ...[0.42, 0.7].flatMap((mx, i) => [
      box([0.22, 0.2, 0.14], [mx, t + 0.1, -0.04], hex(WHITE)),
      cyl(0.15, 0.012, [mx, t + 0.11, 0.037], hex("#f7f3e4"), { rot: ALONG_Z }),
      box([0.008, 0.07, 0.006], [mx + (i ? 0.02 : -0.02), t + 0.12, 0.046], hex(RED), [0, 0, i ? -0.5 : 0.5]),
      cyl(0.035, 0.03, [mx - 0.07, t + 0.205, 0.0], hex(RED)),
      cyl(0.035, 0.03, [mx + 0.07, t + 0.205, 0.0], hex(BLACK)),
    ]),
    // Лампа на подставке и ключ.
    box([0.13, 0.05, 0.13], [1.0, t + 0.025, -0.05], hex(METAL)),
    cyl(0.04, 0.05, [1.0, t + 0.075, -0.05], hex("#b9c1cb")),
    ball(0.15, [1.0, t + 0.19, -0.05], hex("#fff2b0")),
    box([0.14, 0.03, 0.09], [1.2, t + 0.015, 0.05], hex(BLACK)),
    box([0.1, 0.012, 0.02], [1.2, t + 0.06, 0.05], hex("#b9c1cb"), [0, 0, 0.5]),
    // Провода, лежащие на столе.
    box([0.62, 0.012, 0.012], [-0.65, t + 0.007, 0.22], hex(RED)),
    box([0.55, 0.012, 0.012], [0.05, t + 0.007, 0.26], hex(BLACK)),
    box([0.012, 0.012, 0.2], [-0.34, t + 0.007, 0.12], hex(RED)),
    box([0.6, 0.012, 0.012], [0.85, t + 0.007, 0.2], hex(BLACK)),
  ];
}

/** Вид 1: электростатика — генератор Ван де Граафа, электроскоп, палочки. */
function staticSet(): PrimitivePart[] {
  const t = TOP;
  return [
    // Генератор Ван де Граафа.
    cyl(0.4, 0.22, [-0.75, t + 0.11, -0.05], hex("#454c56"), { top: 0.3 }),
    cyl(0.17, 0.4, [-0.75, t + 0.42, -0.05], hex("#9fb8c9")),
    ball(0.34, [-0.75, t + 0.78, -0.05], hex("#cfd6dd")),
    // Разрядник на стойке.
    cyl(0.03, 0.34, [-0.3, t + 0.17, -0.02], hex(METAL)),
    ball(0.1, [-0.3, t + 0.36, -0.02], hex("#cfd6dd")),
    box([0.2, 0.03, 0.2], [-0.3, t + 0.015, -0.02], hex(METAL)),
    // Электроскоп: стеклянная банка, стержень с шариком, два листочка.
    box([0.18, 0.03, 0.18], [0.35, t + 0.015, -0.02], hex(METAL)),
    cyl(0.17, 0.22, [0.35, t + 0.14, -0.02], hex("#bfe3f0")),
    cyl(0.012, 0.22, [0.35, t + 0.33, -0.02], hex("#b9c1cb")),
    ball(0.05, [0.35, t + 0.45, -0.02], hex("#cfd6dd")),
    box([0.004, 0.07, 0.04], [0.33, t + 0.17, -0.02], hex("#e8e0b0"), [0, 0, 0.25]),
    box([0.004, 0.07, 0.04], [0.37, t + 0.17, -0.02], hex("#e8e0b0"), [0, 0, -0.25]),
    // Эбонитовая и стеклянная палочки, шёлк.
    cyl(0.03, 0.4, [0.95, t + 0.015, 0.2], hex("#3a2a22"), { rot: [0, 0.4, HALF_PI] }),
    cyl(0.03, 0.4, [0.85, t + 0.015, 0.03], hex("#bfe3f0"), { rot: [0, -0.2, HALF_PI] }),
    box([0.2, 0.01, 0.16], [0.55, t + 0.005, 0.22], hex("#d98fb0"), [0, 0.3, 0]),
  ];
}

/** Вид 2: магнетизм и плазма — подковообразный и полосовой магниты, компас, плазменный шар, катушка Тесла. */
function magnetSet(): PrimitivePart[] {
  const t = TOP;
  return [
    // Подковообразный магнит.
    box([0.05, 0.2, 0.05], [-1.0, t + 0.1, 0.02], hex(RED)),
    box([0.05, 0.2, 0.05], [-0.84, t + 0.1, 0.02], hex(BLUE)),
    box([0.21, 0.05, 0.05], [-0.92, t + 0.225, 0.02], hex("#8d98a6")),
    // Полосовой магнит и компас.
    box([0.15, 0.04, 0.06], [-0.55, t + 0.02, 0.2], hex(RED), [0, 0.2, 0]),
    box([0.15, 0.04, 0.06], [-0.4, t + 0.02, 0.18], hex(BLUE), [0, 0.2, 0]),
    cyl(0.11, 0.025, [-0.62, t + 0.0125, -0.05], hex("#f7f3e4")),
    box([0.09, 0.006, 0.014], [-0.62, t + 0.028, -0.05], hex(RED), [0, 0.7, 0]),
    // Плазменный шар.
    cyl(0.24, 0.1, [0.05, t + 0.05, -0.05], hex("#2a2d3a"), { top: 0.18 }),
    ball(0.34, [0.05, t + 0.27, -0.05], (_x, y) => (y > t + 0.27 ? hex("#b58cff") : hex("#7b4bd0"))),
    ball(0.1, [0.05, t + 0.27, -0.05], hex("#e4d2ff")),
    // Катушка Тесла: основание, медная вторичная обмотка, тор.
    cyl(0.32, 0.07, [0.85, t + 0.035, -0.04], hex("#2a2d3a")),
    cyl(0.12, 0.52, [0.85, t + 0.33, -0.04], hex(COPPER)),
    ring(0.3, 0.08, [0.85, t + 0.64, -0.04], hex("#cfd6dd")),
    ring(0.26, 0.02, [0.85, t + 0.095, -0.04], hex("#d9a066")),
  ];
}

function buildBench(scene: Scene, variant: number): Mesh {
  const apparatus = variant === 0 ? circuitSet() : variant === 1 ? staticSet() : magnetSet();
  return buildColoredPrimitives(`classroom_bench_${variant}`, [...benchBase(), ...apparatus], scene);
}

// ---------- Стена: доска, окно, плакаты ----------

function buildBoard(scene: Scene): Mesh {
  const parts: PrimitivePart[] = [
    box([BOARD.len, BOARD.h, BOARD.thickness], [0, BOARD.y, 0], hex("#8a6841")),
    box([BOARD.len - 0.2, BOARD.h - 0.2, 0.02], [0, BOARD.y, BOARD.thickness / 2], hex("#2f4a3a")),
    box([BOARD.len - 0.4, 0.04, 0.1], [0, BOARD.y - BOARD.h / 2 - 0.005, BOARD.thickness / 2 + 0.04], hex("#a07a4c")),
    box([0.1, 0.012, 0.025], [-0.9, BOARD.y - BOARD.h / 2 + 0.03, BOARD.thickness / 2 + 0.06], hex("#f4f1e4"), [0, 0.3, 0]),
    box([0.08, 0.012, 0.025], [-0.7, BOARD.y - BOARD.h / 2 + 0.03, BOARD.thickness / 2 + 0.06], hex("#e8c25a"), [0, -0.2, 0]),
    box([0.14, 0.06, 0.04], [0.9, BOARD.y - BOARD.h / 2 + 0.05, BOARD.thickness / 2 + 0.06], hex("#d9d2c0")), // тряпка
  ];
  return buildColoredPrimitives("classroom_board", parts, scene);
}

function buildWindow(scene: Scene): Mesh {
  const { w, h, y, thickness: th } = WINDOW;
  const frame = hex("#f2f0e8");
  const bar = 0.07;
  const glass: ColorFn = (_x, py) => {
    const t = Math.max(0, Math.min(1, (py - (y - h / 2)) / h));
    return [0.62 + 0.28 * t, 0.84 + 0.1 * t, 0.96];
  };
  const parts: PrimitivePart[] = [
    box([w - 0.14, h - 0.14, 0.02], [0, y, 0], glass),
    box([w, bar, th], [0, y + h / 2 - bar / 2, 0.01], frame),
    box([w, bar, th], [0, y - h / 2 + bar / 2, 0.01], frame),
    box([bar, h, th], [-w / 2 + bar / 2, y, 0.01], frame),
    box([bar, h, th], [w / 2 - bar / 2, y, 0.01], frame),
    box([0.05, h - 0.1, th - 0.01], [0, y, 0.01], frame),
    box([w - 0.1, 0.04, th - 0.01], [0, y, 0.01], frame),
    box([w + 0.16, 0.05, 0.2], [0, y - h / 2 - 0.025, 0.09], frame), // подоконник
  ];
  return buildColoredPrimitives("classroom_window", parts, scene);
}

function buildPoster(scene: Scene, variant: number): Mesh {
  const { w, h, y, thickness: th } = POSTER;
  const paper = hex(["#f4e8c8", "#dfeaf2", "#f2dede"][variant % 3]);
  const accent = [
    ["#c0453a", "#3e74c4", "#e0b43c"],
    ["#3e74c4", "#3f9e6b", "#8a5fc0"],
    ["#e08a3c", "#c0453a", "#3f9e6b"],
  ][variant % 3];
  const parts: PrimitivePart[] = [
    box([w, h, th], [0, y, 0], paper),
    box([w - 0.2, 0.14, 0.01], [0, y + h / 2 - 0.16, th / 2 + 0.003], hex(accent[0])),
    box([w - 0.2, 0.34, 0.01], [0, y + 0.08, th / 2 + 0.003], hex(accent[1])),
    ...[0, 1, 2].map((i) => box([0.18, 0.18, 0.01], [-0.25 + i * 0.25, y - h / 2 + 0.2, th / 2 + 0.003], hex(accent[(i + variant) % 3]))),
  ];
  return buildColoredPrimitives(`classroom_poster_${variant}`, parts, scene);
}

// ---------- Стеллаж, шкаф, горшок ----------

function buildShelf(scene: Scene): Mesh {
  const { len, depth, h } = SHELF;
  const wood = tone("#b78a55", 0.75, h);
  const parts: PrimitivePart[] = [
    box([0.04, h, depth], [-len / 2 + 0.02, h / 2, 0], wood),
    box([0.04, h, depth], [len / 2 - 0.02, h / 2, 0], wood),
    box([len - 0.08, h - 0.1, 0.02], [0, h / 2, -depth / 2 + 0.01], tone("#8a6841", 0.75, h)),
  ];
  const levels = [0.04, 0.46, 0.88, 1.3, h - 0.02];
  levels.forEach((ly) => parts.push(box([len - 0.08, 0.035, depth], [0, ly, 0], wood)));
  // Книги и коробки на полках — детерминированно по индексам.
  levels.slice(0, 4).forEach((ly, row) => {
    let x = -len / 2 + 0.1;
    for (let i = 0; i < 12 && x < len / 2 - 0.12; i++) {
      const bw = 0.04 + hash01(row, i, 1) * 0.05;
      const bh = 0.22 + hash01(row, i, 2) * 0.14;
      if (hash01(row, i, 3) < 0.12) {
        x += 0.12;
        continue;
      }
      const color = BOOK_COLORS[Math.floor(hash01(row, i, 4) * BOOK_COLORS.length)];
      parts.push(box([bw, bh, depth - 0.12], [x + bw / 2, ly + 0.0175 + bh / 2, 0.02], tone(color, 0.8, h)));
      x += bw + 0.008;
    }
  });
  return buildColoredPrimitives("classroom_shelf", parts, scene);
}

/** Приборный шкаф со стеклянными дверцами и жёлтой полосой — высокое укрытие. */
function buildCabinet(scene: Scene): Mesh {
  const { len, depth, h } = CABINET;
  const steel = tone(STEEL, 0.78, h);
  const glass: ColorFn = (_x, y) => scaleRgb(hex("#a9cfe0"), 0.85 + 0.15 * Math.min(1, y / h));
  const parts: PrimitivePart[] = [
    box([len, h - 0.1, depth], [0, 0.1 + (h - 0.1) / 2, 0], steel),
    box([len + 0.04, 0.1, depth + 0.04], [0, 0.05, 0], hex("#2a2f36")),
    box([len + 0.04, 0.05, depth + 0.04], [0, h - 0.025, 0], tone("#59616b", 0.8, h)),
    ...[-1, 1].flatMap((sx) => [
      box([len / 2 - 0.12, h - 0.55, 0.02], [sx * (len / 4), 0.1 + 0.22 + (h - 0.55) / 2, depth / 2 + 0.005], glass),
      box([0.025, 0.28, 0.03], [sx * 0.07, 1.1, depth / 2 + 0.03], hex(METAL)),
    ]),
    // Нижние глухие дверцы и предупреждающая полоса сверху.
    box([len - 0.08, 0.2, 0.02], [0, 0.28, depth / 2 + 0.005], tone("#5d6a77", 0.8, h)),
    box([len - 0.08, 0.1, 0.02], [0, h - 0.17, depth / 2 + 0.005], hex("#e8c13a")),
    ...[0.2, 0.55, 0.9, 1.25].map((ly) => box([len / 2 - 0.2, 0.02, depth - 0.15], [-len / 4, 0.3 + ly, 0], hex("#b9c1cb"))),
    // Силуэты приборов за стеклом.
    box([0.28, 0.18, 0.2], [-0.62, 0.52, 0.0], hex("#e8e4d4")),
    cyl(0.2, 0.2, [-0.18, 0.54, 0.0], hex(COPPER)),
    box([0.3, 0.2, 0.2], [0.55, 0.88, 0.0], hex("#454c56")),
    ball(0.16, [-0.55, 1.35, 0.0], hex("#fff2b0")),
  ];
  return buildColoredPrimitives("classroom_cabinet", parts, scene);
}

/** Открытый стеллаж с приборами — второй вид высокого укрытия. */
function buildRack(scene: Scene): Mesh {
  const { len, depth, h } = CABINET;
  const frame = tone("#59616b", 0.78, h);
  const board = tone("#c9a06a", 0.78, h);
  const parts: PrimitivePart[] = [
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box([0.06, h, 0.06], [sx * (len / 2 - 0.03), h / 2, sz * (depth / 2 - 0.03)], frame))),
    box([len, h - 0.1, 0.02], [0, h / 2 + 0.05, -depth / 2 + 0.01], tone("#7a8794", 0.78, h)),
  ];
  const levels = [0.08, 0.5, 0.92, 1.34, 1.76, h - 0.03];
  levels.forEach((ly) => parts.push(box([len, 0.04, depth], [0, ly, 0], board)));
  // Приборы на полках: катушки, измерители, батареи, лампы.
  levels.slice(0, 5).forEach((ly, row) => {
    for (let i = 0; i < 4; i++) {
      const x = -len / 2 + 0.25 + i * 0.4 + (hash01(row, i, 7) - 0.5) * 0.06;
      const pick = Math.floor(hash01(row, i, 8) * 5);
      const y0 = ly + 0.02;
      if (pick === 0) parts.push(cyl(0.2, 0.22, [x, y0 + 0.11, 0.02], hex(COPPER)), cyl(0.06, 0.26, [x, y0 + 0.13, 0.02], hex("#d9c7a3")));
      else if (pick === 1) parts.push(box([0.24, 0.22, 0.16], [x, y0 + 0.11, 0.02], hex(WHITE)), cyl(0.14, 0.01, [x, y0 + 0.12, 0.105], hex(BLACK), { rot: ALONG_Z }));
      else if (pick === 2) parts.push(box([0.2, 0.14, 0.16], [x, y0 + 0.07, 0.02], hex(RED)), box([0.2, 0.05, 0.16], [x, y0 + 0.165, 0.02], hex(BLACK)));
      else if (pick === 3) parts.push(box([0.14, 0.04, 0.14], [x, y0 + 0.02, 0.02], hex(METAL)), ball(0.15, [x, y0 + 0.12, 0.02], hex("#fff2b0")));
      else parts.push(box([0.26, 0.1, 0.18], [x, y0 + 0.05, 0.02], hex("#454c56")), cyl(0.05, 0.1, [x, y0 + 0.15, 0.02], hex("#cfd6dd")));
    }
  });
  return buildColoredPrimitives("classroom_rack", parts, scene);
}

/** Горшок под куст-«комнатное растение»: низ на полу, листва садится сверху (см. POT_HEIGHT). */
export const POT_HEIGHT = 0.45;

function buildPot(scene: Scene): Mesh {
  const terracotta = tone("#b4663b", 0.78, POT_HEIGHT);
  const parts: PrimitivePart[] = [
    cyl(0.55, POT_HEIGHT - 0.06, [0, (POT_HEIGHT - 0.06) / 2, 0], terracotta, { top: 0.78, sides: 12 }),
    cyl(0.86, 0.07, [0, POT_HEIGHT - 0.035, 0], tone("#c47749", 0.85, POT_HEIGHT), { sides: 12 }),
    cyl(0.7, 0.02, [0, POT_HEIGHT - 0.01, 0], hex("#3b2a1e"), { sides: 12 }),
  ];
  return buildColoredPrimitives("classroom_pot", parts, scene);
}

// ---------- Набор шаблонов на сцену ----------

export interface ClassroomKit {
  desks: Mesh[];
  benches: Mesh[];
  board: Mesh;
  window: Mesh;
  posters: Mesh[];
  shelf: Mesh;
  cabinet: Mesh;
  rack: Mesh;
  pot: Mesh;
}

/** Все шаблоны класса: строятся один раз на сцену, выключены (рисуются только их instances/клоны). */
export const classroomKit = perScene((scene): ClassroomKit => {
  const kit: ClassroomKit = {
    desks: [0, 1, 2].map((v) => buildDesk(scene, v)),
    benches: [0, 1, 2].map((v) => buildBench(scene, v)),
    board: buildBoard(scene),
    window: buildWindow(scene),
    posters: [0, 1, 2].map((v) => buildPoster(scene, v)),
    shelf: buildShelf(scene),
    cabinet: buildCabinet(scene),
    rack: buildRack(scene),
    pot: buildPot(scene),
  };
  const all = [...kit.desks, ...kit.benches, kit.board, kit.window, ...kit.posters, kit.shelf, kit.cabinet, kit.rack, kit.pot];
  for (const mesh of all) mesh.setEnabled(false);
  return kit;
});
