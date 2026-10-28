import { hash01 } from "../../../render/noise";
import type { SectionSpec } from "../../spec/SectionSpec";

/**
 * Раскладка стимпанк-цеха (тема «термодинамика») — ЧИСТАЯ функция от SectionSpec
 * (без Babylon, без общего rng): где стоят ящики и бочки, паровые машины у стен,
 * латунные таблички, баки, котлы и паровые башни.
 *
 * Вариативность берётся из хэша от стабильных данных секции (индекс, ветка,
 * положение предмета), а не из потока генератора — поэтому:
 *  - мир по seed не меняется от того, что где-то появился цех;
 *  - при пересборке секции (стриминг) всё встаёт ровно туда же;
 *  - раскладку можно проверять в Node (scripts/test-steampunk.ts).
 *
 * Координаты ЛОКАЛЬНЫЕ (x — поперёк коридора, z — вдоль оси; 0 = вход секции).
 * Предметы не занимают места сущностей из spec (ведьмы гуляют вокруг точки спавна,
 * костры, сундуки, цели, укрытия), вход, выход с воротами и проёмы ниш.
 */

// ---------- Размеры (м), общие с моделями ----------

/** Напольный реквизит (ящики, бочки, малая машина, тележка с углём): все умещаются в один габарит. */
export const PROP = { w: 1.5, d: 1.0, h: 1.1 } as const;
/** Паровая машина / котёл-топка / теплолаборатория у стены. */
export const MACHINE = { len: 2.6, depth: 0.95, h: 1.1 } as const;
/** Латунная табличка с формулой (висит на стене, без коллизии). */
export const PLAQUE = { len: 2.8, h: 1.3, y: 1.55, thickness: 0.07 } as const;
/** Декор над машиной: иллюминатор, трубы, шестерня (висят на стене, без коллизии). */
export const PORTHOLE = { d: 0.95, y: 2.05, thickness: 0.12 } as const;
export const PIPES = { len: 2.6, thickness: 0.2 } as const;
export const WALL_GEAR = { d: 1.3, y: 1.9, thickness: 0.1 } as const;
/** Вертикальный напорный бак у стены. */
export const TANK = { len: 1.3, depth: 1.1, h: 2.4 } as const;
/** Вертикальный паровой котёл — высокое укрытие (на месте «дерева»). */
export const BOILER = { diameter: 1.3, h: 2.9 } as const;
/** Паровая башня с шестернями — второй вид высокого укрытия. */
export const TOWER = { len: 1.6, depth: 0.8, h: 2.5 } as const;

/** Зазор между предметом и стеной (стена — граница пола; тело стены растёт наружу). */
export const WALL_GAP = 0.04;

// ---------- Результат ----------

export type WallSide = "left" | "right";
export type WallItemKind = "machine" | "plaque" | "tank";
export type WallDecor = "porthole" | "pipes" | "gear" | "none";

/** Напольный реквизит; повёрнут вдоль курса секции + yawJitter. */
export interface PropPlacement {
  x: number;
  z: number;
  yawJitter: number;
  /** 0..3 — ящики / бочки / малая паровая машина / тележка с углём. */
  variant: number;
}

/** Предмет вдоль стены: центр по z, длина вдоль стены, что висит над ним. */
export interface WallItem {
  kind: WallItemKind;
  side: WallSide;
  z: number;
  length: number;
  /** Вид шаблона (машина: двигатель / топка / лаборатория; табличка: какая формула). */
  variant: number;
  decor: WallDecor;
}

/** Котёл или паровая башня на месте «дерева» из spec.trees: укрытие от взгляда ведьм. */
export interface CoverPlacement {
  /** Индекс в spec.trees (по нему SectionChunk связывает укрытие и сид). */
  treeIndex: number;
  x: number;
  z: number;
  kind: "boiler" | "tower";
  /** Поворот кратно 90° относительно курса секции — башни стоят «по линейке». */
  quarterTurns: number;
}

export interface SteampunkLayout {
  props: PropPlacement[];
  wall: WallItem[];
  cover: CoverPlacement[];
}

// ---------- Параметры раскладки ----------

/** Расстояние между осями колонок реквизита поперёк и между рядами вдоль. */
const COLUMN_STEP = 4.4;
const ROW_STEP = 3.6;
/** Реквизит не ставим ближе этого к стенам (место машинам, бакам и проходу). */
export const PROP_WALL_MARGIN = 3.4;
/** Свободны: вход (где стоят ворота предыдущей секции) и выход с воротами. */
export const ENTRANCE_CLEAR = 4.0;
export const EXIT_CLEAR = 4.5;
/** Доля занятых мест в сетке реквизита (остальное — пустые клетки, проходы): цех не должен быть свалкой. */
const PROP_FILL = 0.5;
/** Радиус реквизита для зазоров. */
export const PROP_RADIUS = 1.0;

/** Радиусы «личного пространства» сущностей: предметы в них не попадают. */
export const CLEAR = { witch: 2.4, bonfire: 1.5, chest: 1.5, target: 1.5, bush: 1.7, tree: 1.5 } as const;

interface Disc {
  x: number;
  z: number;
  r: number;
}

function branchCode(spec: SectionSpec): number {
  return spec.forkBranch === "a" ? 1 : spec.forkBranch === "b" ? 2 : 0;
}

/** Всё, что предметы обязаны обходить. */
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

export function layoutSteampunk(spec: SectionSpec): SteampunkLayout {
  const key = spec.index * 131 + branchCode(spec) * 17 + 11;
  const obstacles = obstaclesOf(spec);
  return {
    props: layoutProps(spec, key, obstacles),
    wall: layoutWalls(spec, key, obstacles),
    cover: layoutCover(spec, key),
  };
}

// ---------- Напольный реквизит ----------

function layoutProps(spec: SectionSpec, key: number, obstacles: readonly Disc[]): PropPlacement[] {
  const half = spec.width / 2;
  const usable = half - PROP_WALL_MARGIN;
  if (usable < 0) return [];
  const columns = Math.floor((2 * usable) / COLUMN_STEP) + 1;

  const props: PropPlacement[] = [];
  let row = 0;
  for (let z = ENTRANCE_CLEAR + 1; z <= spec.length - EXIT_CLEAR; z += ROW_STEP, row++) {
    for (let c = 0; c < columns; c++) {
      if (hash01(key, row, c, 1) >= PROP_FILL) continue;
      const x = (c - (columns - 1) / 2) * COLUMN_STEP + (hash01(key, row, c, 2) - 0.5) * 0.6;
      const zz = z + (hash01(key, row, c, 3) - 0.5) * 0.6;
      if (hitsObstacle(x, zz, PROP_RADIUS, obstacles)) continue;
      if (inSpurMouth(spec, x, zz, PROP_RADIUS)) continue;
      props.push({
        x,
        z: zz,
        // Ящики и бочки стоят не «по линейке» — небольшой, но заметный разворот.
        yawJitter: (hash01(key, row, c, 4) - 0.5) * 0.5,
        variant: Math.min(3, Math.floor(hash01(key, row, c, 5) * 4)),
      });
    }
  }
  return props;
}

/** Попадает ли точка (с запасом) в зону перед проёмом боковой ниши — её не загромождаем. */
function inSpurMouth(spec: SectionSpec, x: number, z: number, radius: number): boolean {
  const half = spec.width / 2;
  return spec.sideSpurs.some((s) => {
    const nearWall = s.side === "right" ? x > half - 7 : x < -(half - 7);
    return nearWall && Math.abs(z - s.doorZ) < s.width / 2 + 2 + radius;
  });
}

// ---------- Предметы вдоль стен ----------

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
      let kind: WallItemKind = roll < 0.5 ? "machine" : roll < 0.75 ? "plaque" : "tank";
      if (kind === "plaque" && prevKind === "plaque") kind = "machine"; // две таблички подряд — перебор
      const length = kind === "machine" ? MACHINE.len : kind === "plaque" ? PLAQUE.len : TANK.len;
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
          decor: kind === "machine" ? (decorRoll < 0.4 ? "porthole" : decorRoll < 0.8 ? "pipes" : "gear") : "none",
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
  // Круг личного пространства сущности против прямоугольника предмета (глубина бака — самая большая).
  const wallX = side === "right" ? half : -half;
  return obstacles.some((o) => {
    const beyondFront = Math.max(0, Math.abs(o.x - wallX) - TANK.depth);
    const beyondEnd = Math.max(0, Math.abs(o.z - center) - length / 2);
    return Math.hypot(beyondFront, beyondEnd) < o.r;
  });
}

// ---------- Котлы и башни (укрытия) ----------

function layoutCover(spec: SectionSpec, key: number): CoverPlacement[] {
  return spec.trees.map((t, i) => ({
    treeIndex: i,
    x: t.x,
    z: t.z,
    kind: hash01(key, Math.round(t.x * 10), Math.round(t.z * 10), 20) < 0.55 ? "boiler" : "tower",
    quarterTurns: ((Math.round(t.rot / (Math.PI / 2)) % 4) + 4) % 4,
  }));
}
