import { hash01 } from "../../../render/noise";
import type { SectionSpec } from "../../spec/SectionSpec";

/**
 * Раскладка школьного класса — ЧИСТАЯ функция от SectionSpec (без Babylon, без
 * общего rng): где стоят парты, лабораторные столы у стен, доски, окна и шкафы.
 *
 * Вариативность берётся из хэша от стабильных данных секции (индекс, ветка,
 * положение мебели), а не из потока генератора — поэтому:
 *  - мир по seed не меняется от того, что где-то появился класс;
 *  - при пересборке секции (стриминг) мебель встаёт ровно туда же;
 *  - раскладку можно проверять в Node (scripts/test-biomes.ts).
 *
 * Координаты ЛОКАЛЬНЫЕ (x — поперёк коридора, z — вдоль оси; 0 = вход секции).
 * Мебель не занимает места сущностей из spec (ведьмы гуляют вокруг точки спавна,
 * костры, сундуки, цели, кусты-укрытия), вход, выход с воротами и проёмы ниш.
 */

// ---------- Размеры мебели (м), общие с моделями ----------

export const DESK = { w: 1.5, d: 0.6, h: 0.76, chairBack: 0.72 } as const;
export const BENCH = { len: 2.6, depth: 0.85, h: 0.92 } as const;
export const BOARD = { len: 3.4, h: 1.3, y: 1.5, thickness: 0.08 } as const;
export const WINDOW = { w: 1.9, h: 1.25, y: 1.88, thickness: 0.06 } as const;
export const POSTER = { w: 0.9, h: 1.2, y: 1.82, thickness: 0.03 } as const;
export const SHELF = { len: 1.6, depth: 0.42, h: 1.8 } as const;
export const CABINET = { len: 1.7, depth: 0.6, h: 2.1 } as const;

/** Зазор между мебелью и стеной (стена — граница пола; тело стены растёт наружу). */
export const WALL_GAP = 0.04;

// ---------- Результат ----------

export type WallSide = "left" | "right";
export type WallItemKind = "bench" | "board" | "shelf";
export type WallDecor = "window" | "poster" | "none";

/** Парта на двоих с двумя стульями; повёрнута вдоль курса секции + yawJitter. */
export interface DeskPlacement {
  x: number;
  z: number;
  yawJitter: number;
  /** 0..2 — как задвинуты стулья (вид шаблона). */
  variant: number;
}

/** Мебель вдоль стены: центр по z, длина вдоль стены, что висит над ней. */
export interface WallItem {
  kind: WallItemKind;
  side: WallSide;
  z: number;
  length: number;
  /** Вид шаблона (оборудование на столе / надписи на доске). */
  variant: number;
  decor: WallDecor;
  decorVariant: number;
}

/** Высокий шкаф или стеллаж на месте «дерева» из spec.trees: укрытие от взгляда ведьм. */
export interface CabinetPlacement {
  /** Индекс в spec.trees (по нему SectionChunk связывает укрытие и сид). */
  treeIndex: number;
  x: number;
  z: number;
  kind: "cabinet" | "rack";
  /** Поворот кратно 90° относительно курса секции — мебель стоит «по линейке». */
  quarterTurns: number;
}

export interface ClassroomLayout {
  desks: DeskPlacement[];
  wall: WallItem[];
  cabinets: CabinetPlacement[];
}

// ---------- Параметры раскладки ----------

/** Расстояние между осями колонок парт поперёк и между рядами вдоль. */
const COLUMN_STEP = 4.2;
const ROW_STEP = 3.3;
/** Парты не ставим ближе этого к стенам (место столам, шкафам и проходу). */
export const DESK_WALL_MARGIN = 3.4;
/** Свободны: вход (где стоят ворота предыдущей секции) и выход с воротами. */
export const ENTRANCE_CLEAR = 4.0;
export const EXIT_CLEAR = 4.5;
/** Доля занятых мест в сетке парт (остальное — пустые клетки, проходы). */
const DESK_FILL = 0.7;
/** Радиус парты для зазоров. */
export const DESK_RADIUS = 1.0;

/** Радиусы «личного пространства» сущностей: мебель в них не попадает. */
export const CLEAR = { witch: 2.4, bonfire: 1.5, chest: 1.5, target: 1.5, bush: 1.7, tree: 1.5 } as const;

interface Disc {
  x: number;
  z: number;
  r: number;
}

function branchCode(spec: SectionSpec): number {
  return spec.forkBranch === "a" ? 1 : spec.forkBranch === "b" ? 2 : 0;
}

/** Всё, что мебель обязана обходить. */
function obstaclesOf(spec: SectionSpec): Disc[] {
  const out: Disc[] = [];
  for (const w of spec.witches) out.push({ x: w.x, z: w.z, r: CLEAR.witch });
  for (const b of spec.bonfires) out.push({ x: b.x, z: b.z, r: CLEAR.bonfire });
  for (const c of spec.chests) out.push({ x: c.x, z: c.z, r: CLEAR.chest });
  for (const p of spec.practiceTargets) out.push({ x: p.x, z: p.z, r: CLEAR.target });
  for (const b of spec.bushes) out.push({ x: b.x, z: b.z, r: CLEAR.bush * b.scale });
  for (const t of spec.trees) out.push({ x: t.x, z: t.z, r: CLEAR.tree });
  return out;
}

function hitsObstacle(x: number, z: number, radius: number, obstacles: readonly Disc[]): boolean {
  return obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + radius);
}

export function layoutClassroom(spec: SectionSpec): ClassroomLayout {
  const key = spec.index * 131 + branchCode(spec) * 17 + 5;
  const obstacles = obstaclesOf(spec);
  return {
    desks: layoutDesks(spec, key, obstacles),
    wall: layoutWalls(spec, key, obstacles),
    cabinets: layoutCabinets(spec, key),
  };
}

// ---------- Парты ----------

function layoutDesks(spec: SectionSpec, key: number, obstacles: readonly Disc[]): DeskPlacement[] {
  const half = spec.width / 2;
  const usable = half - DESK_WALL_MARGIN;
  if (usable < 0) return [];
  const columns = Math.floor((2 * usable) / COLUMN_STEP) + 1;

  const desks: DeskPlacement[] = [];
  let row = 0;
  for (let z = ENTRANCE_CLEAR + 1; z <= spec.length - EXIT_CLEAR; z += ROW_STEP, row++) {
    for (let c = 0; c < columns; c++) {
      if (hash01(key, row, c, 1) >= DESK_FILL) continue;
      const x = (c - (columns - 1) / 2) * COLUMN_STEP + (hash01(key, row, c, 2) - 0.5) * 0.2;
      const zz = z + (hash01(key, row, c, 3) - 0.5) * 0.3;
      if (hitsObstacle(x, zz, DESK_RADIUS, obstacles)) continue;
      if (inSpurMouth(spec, x, zz, DESK_RADIUS)) continue;
      desks.push({
        x,
        z: zz,
        yawJitter: (hash01(key, row, c, 4) - 0.5) * 0.1,
        variant: Math.min(2, Math.floor(hash01(key, row, c, 5) * 3)),
      });
    }
  }
  return desks;
}

/** Попадает ли точка (с запасом) в зону перед проёмом боковой ниши — её не загромождаем. */
function inSpurMouth(spec: SectionSpec, x: number, z: number, radius: number): boolean {
  const half = spec.width / 2;
  return spec.sideSpurs.some((s) => {
    const nearWall = s.side === "right" ? x > half - 7 : x < -(half - 7);
    return nearWall && Math.abs(z - s.doorZ) < s.width / 2 + 2 + radius;
  });
}

// ---------- Мебель вдоль стен ----------

export const WALL_START = 3.2;
export const WALL_END_CLEAR = 3.0;

function layoutWalls(spec: SectionSpec, key: number, obstacles: readonly Disc[]): WallItem[] {
  const items: WallItem[] = [];
  const half = spec.width / 2;
  const sides: readonly WallSide[] = ["left", "right"];

  sides.forEach((side, sideIndex) => {
    let z = WALL_START + hash01(key, sideIndex, 90, 0) * 1.5;
    let prevKind: WallItemKind | null = null;
    for (let n = 0; z < spec.length - WALL_END_CLEAR; n++) {
      const roll = hash01(key, sideIndex, n, 10);
      let kind: WallItemKind = roll < 0.5 ? "bench" : roll < 0.72 ? "board" : "shelf";
      if (kind === "board" && prevKind === "board") kind = "bench"; // две доски подряд — перебор
      const length = kind === "bench" ? BENCH.len : kind === "board" ? BOARD.len : SHELF.len;
      const center = z + length / 2;
      if (center + length / 2 > spec.length - WALL_END_CLEAR) break;

      const blocked = wallSlotBlocked(spec, side, center, length, half, obstacles);
      if (!blocked) {
        const decorRoll = hash01(key, sideIndex, n, 11);
        items.push({
          kind,
          side,
          z: center,
          length,
          variant: Math.min(2, Math.floor(hash01(key, sideIndex, n, 12) * 3)),
          decor: kind === "bench" ? (decorRoll < 0.6 ? "window" : "poster") : "none",
          decorVariant: Math.min(2, Math.floor(hash01(key, sideIndex, n, 13) * 3)),
        });
        prevKind = kind;
      }
      z += length + 0.3 + hash01(key, sideIndex, n, 14) * 0.7;
    }
  });
  return items;
}

/** Слот у стены занят: проём ниши или сущность, стоящая у этой стены. */
function wallSlotBlocked(
  spec: SectionSpec,
  side: WallSide,
  center: number,
  length: number,
  half: number,
  obstacles: readonly Disc[]
): boolean {
  for (const s of spec.sideSpurs) {
    if (s.side === side && Math.abs(center - s.doorZ) < s.width / 2 + length / 2 + 0.8) return true;
  }
  // Круг личного пространства сущности против прямоугольника мебели (глубина стола — самая большая).
  const wallX = side === "right" ? half : -half;
  return obstacles.some((o) => {
    const beyondFront = Math.max(0, Math.abs(o.x - wallX) - BENCH.depth);
    const beyondEnd = Math.max(0, Math.abs(o.z - center) - length / 2);
    return Math.hypot(beyondFront, beyondEnd) < o.r;
  });
}

// ---------- Шкафы (укрытия) ----------

function layoutCabinets(spec: SectionSpec, key: number): CabinetPlacement[] {
  return spec.trees.map((t, i) => ({
    treeIndex: i,
    x: t.x,
    z: t.z,
    kind: hash01(key, Math.round(t.x * 10), Math.round(t.z * 10), 20) < 0.55 ? "cabinet" : "rack",
    quarterTurns: ((Math.round(t.rot / (Math.PI / 2)) % 4) + 4) % 4,
  }));
}
