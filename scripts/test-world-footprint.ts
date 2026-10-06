/**
 * Проверка ГЕОМЕТРИИ пола и стен мира — то, что видит и чувствует игрок.
 *
 * Проверяется не промежуточная арифметика (интервалы щелей), а ИТОГОВАЯ
 * геометрия: именно на ней на стыках то пропадали, то появлялись лишние куски
 * стены. Разными независимыми способами:
 *
 *  A0. Лицевая грань ленты пола смотрит вверх (Babylon-коллизии «не видят» пол
 *      с обратной ориентацией: игрок по нему не стоит, а проваливается).
 *  A1. Каждый кусок стены стоит ровно на границе пола: изнутри пол, снаружи
 *      пустота (нет «лишних» стен посреди пола и стен в воздухе).
 *  A2. Тело стены не заходит в пол (Монте-Карло; «укус» мельче 3 см не в счёт —
 *      дуга и хорда полилинии расходятся на миллиметры, а у вершины клина
 *      между ветками щель уже толщины стены).
 *  A3. Нет открытой границы: каждая точка контура пола, за которой пустота,
 *      накрыта телом какой-то стены (нельзя упасть).
 *  Каждый мир проверяется дважды: исходный и продлённый extendWorld (хвост мира
 *  меняется — стык старого хвоста с новыми секциями не должен остаться глухим).
 *  B.  Растровый «игрок»: заливка с радиусом коллайдера 0.4 м от спавна.
 *      B1: заливка нигде не дотягивается до пустоты (не провалиться);
 *      B2: она достаёт до подхода к башне и до каждой полосы/ниши мира
 *      (не заперт, всё проходимо при открытых воротах).
 *
 * Модуль Footprint — чистая математика, поэтому гоняем много сидов.
 */
import { extendWorld, generateWorld } from "../src/world/WorldGenerator";
import type { WorldSpec } from "../src/world/spec/WorldSpec";
import { FootprintIndex, pointInPolygon } from "../src/world/geometry/Footprint";
import type { FootprintPiece, WallSeg } from "../src/world/geometry/Footprint";
import { distPointToSegment, localToWorld } from "../src/world/geometry/SectionGeometry";
import type { Vec2 } from "../src/world/geometry/SectionGeometry";
import { GameState } from "../src/core/GameState";

declare const process: { exit(code?: number): never; env: Record<string, string | undefined> };

const SEEDS = Number(process.env.SEEDS ?? 120);
const AGENT_RADIUS = 0.4; // эллипсоид игрока, см. PlayerController
const CELL = 0.25;

let checks = 0;
let failures = 0;
const MAX_REPORT = 25;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= MAX_REPORT) console.error(`FAIL: ${msg}`);
  }
}

// Детерминированный rng для Монте-Карло (чтобы тест был воспроизводим).
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Координаты точки p в системе куска стены: u вдоль, v наружу от границы. */
function wallFrame(w: WallSeg, p: Vec2): { u: number; v: number; len: number } {
  const dx = w.b.x - w.a.x;
  const dz = w.b.z - w.a.z;
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const px = p.x - w.a.x;
  const pz = p.z - w.a.z;
  return { u: px * ux + pz * uz, v: px * w.n.x + pz * w.n.z, len };
}

/** Точка внутри полигона и дальше `depth` от каждого его ребра. */
function insideDeep(q: FootprintPiece, x: number, z: number, depth: number): boolean {
  const b = q.bbox;
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
  if (!pointInPolygon(x, z, q.outline)) return false;
  for (let i = 0; i < q.outline.length; i++) {
    const a = q.outline[i];
    const c = q.outline[(i + 1) % q.outline.length];
    if (distPointToSegment(x, z, a.x, a.z, c.x, c.z) < depth) return false;
  }
  return true;
}

function allWalls(index: FootprintIndex, sections: ReturnType<typeof generateWorld>["sections"]): WallSeg[] {
  const out: WallSeg[] = [];
  for (const s of sections) out.push(...index.wallsOf(s));
  return out;
}

// ---------------------------------------------------------------------------
// Растровый «игрок»
// ---------------------------------------------------------------------------

interface Grid {
  minX: number;
  minZ: number;
  w: number;
  h: number;
  floor: Uint8Array;
  blocked: Uint8Array;
}

function buildGrid(pieces: readonly FootprintPiece[], walls: WallSeg[]): Grid {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of pieces) {
    minX = Math.min(minX, p.bbox.minX);
    minZ = Math.min(minZ, p.bbox.minZ);
    maxX = Math.max(maxX, p.bbox.maxX);
    maxZ = Math.max(maxZ, p.bbox.maxZ);
  }
  minX -= 3;
  minZ -= 3;
  maxX += 3;
  maxZ += 3;
  const w = Math.ceil((maxX - minX) / CELL);
  const h = Math.ceil((maxZ - minZ) / CELL);
  const floor = new Uint8Array(w * h);
  const blocked = new Uint8Array(w * h);

  // Пол: построчная заливка полигонов (чётно-нечётное правило).
  for (const p of pieces) {
    const poly = p.outline;
    const j0 = Math.max(0, Math.floor((p.bbox.minZ - minZ) / CELL));
    const j1 = Math.min(h - 1, Math.ceil((p.bbox.maxZ - minZ) / CELL));
    for (let j = j0; j <= j1; j++) {
      const z = minZ + (j + 0.5) * CELL;
      const xs: number[] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        if (a.z > z !== b.z > z) xs.push(a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z));
      }
      xs.sort((x, y) => x - y);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - minX) / CELL - 0.5));
        const i1 = Math.min(w - 1, Math.floor((xs[k + 1] - minX) / CELL - 0.5));
        for (let i = i0; i <= i1; i++) floor[j * w + i] = 1;
      }
    }
  }

  // Стены: клетки ближе AGENT_RADIUS к телу стены недоступны центру игрока.
  for (const wl of walls) {
    const xs = [wl.a.x, wl.b.x, wl.a.x + wl.n.x * wl.t, wl.b.x + wl.n.x * wl.t];
    const zs = [wl.a.z, wl.b.z, wl.a.z + wl.n.z * wl.t, wl.b.z + wl.n.z * wl.t];
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - AGENT_RADIUS - minX) / CELL));
    const i1 = Math.min(w - 1, Math.ceil((Math.max(...xs) + AGENT_RADIUS - minX) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(...zs) - AGENT_RADIUS - minZ) / CELL));
    const j1 = Math.min(h - 1, Math.ceil((Math.max(...zs) + AGENT_RADIUS - minZ) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = { x: minX + (i + 0.5) * CELL, z: minZ + (j + 0.5) * CELL };
        const { u, v, len } = wallFrame(wl, c);
        const du = Math.max(-u, 0, u - len);
        const dv = Math.max(-v, 0, v - wl.t);
        if (Math.hypot(du, dv) < AGENT_RADIUS) blocked[j * w + i] = 1;
      }
    }
  }
  return { minX, minZ, w, h, floor, blocked };
}

function cellOf(g: Grid, p: Vec2): number {
  const i = Math.floor((p.x - g.minX) / CELL);
  const j = Math.floor((p.z - g.minZ) / CELL);
  return j * g.w + i;
}

function posOf(g: Grid, cell: number): Vec2 {
  return { x: g.minX + ((cell % g.w) + 0.5) * CELL, z: g.minZ + (Math.floor(cell / g.w) + 0.5) * CELL };
}

/** Заливка от спавна: возвращает посещённые клетки и клетки пустоты, до которых игрок дотянулся. */
function flood(g: Grid, start: number): { seen: Uint8Array; leaks: number[] } {
  const seen = new Uint8Array(g.w * g.h);
  const leaks: number[] = [];
  const queue = new Int32Array(g.w * g.h);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  seen[start] = 1;
  while (head < tail) {
    const c = queue[head++];
    if (!g.floor[c]) {
      leaks.push(c); // дотянулись до пустоты — игрок падает, дальше не идём
      continue;
    }
    const i = c % g.w;
    const j = (c - i) / g.w;
    const next = [i > 0 ? c - 1 : -1, i < g.w - 1 ? c + 1 : -1, j > 0 ? c - g.w : -1, j < g.h - 1 ? c + g.w : -1];
    for (const n of next) {
      if (n < 0 || seen[n] || g.blocked[n]) continue;
      seen[n] = 1;
      queue[tail++] = n;
    }
  }
  return { seen, leaks };
}

function pieceProbe(p: FootprintPiece): Vec2 {
  const [ra, rb] = p.rails;
  const k = Math.floor((ra.length - 1) / 2);
  const k2 = Math.min(k + (ra.length % 2 === 0 ? 1 : 0), ra.length - 1);
  const a = { x: (ra[k].x + ra[k2].x) / 2, z: (ra[k].z + ra[k2].z) / 2 };
  const b = { x: (rb[k].x + rb[k2].x) / 2, z: (rb[k].z + rb[k2].z) / 2 };
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

// ---------------------------------------------------------------------------
// Прогон по сидам
// ---------------------------------------------------------------------------

let wallCount = 0;
let thinCount = 0;
let pieceCount = 0;
let seamWorlds = 0;
let spurPieces = 0;
let floodCells = 0;

/** Полная проверка одного мира (исходного или продлённого extendWorld). */
function verifyWorld(seedNum: number, label: string, world: WorldSpec): void {
  const seed = `${label}${seedNum}`; // для сообщений об ошибках
  const index = new FootprintIndex(world.sections);
  const walls = allWalls(index, world.sections);
  wallCount += walls.length;
  pieceCount += index.pieces.length;
  if (world.sections.some((s) => s.seam)) seamWorlds++;
  spurPieces += index.pieces.filter((p) => p.kind === "spur").length;
  const rnd = lcg(seedNum * 7919);

  // --- A0: лицевая грань ленты пола смотрит ВВЕРХ (иначе игрок проваливается) ---
  for (const p of index.pieces) {
    const [ra, rb] = p.rails;
    const tx = ra[ra.length - 1].x - ra[0].x;
    const tz = ra[ra.length - 1].z - ra[0].z;
    const cx = rb[0].x - ra[0].x;
    const cz = rb[0].z - ra[0].z;
    check(tz * cx - tx * cz > 0, `seed ${seed} ${p.id}: лента пола смотрит ВНИЗ — по ней нельзя стоять`);
  }

  // --- A00: ветки одной развилки не накладываются друг на друга ---
  // Наложенные полы дают «общий» пол без границы между ветками: разделяющей стены
  // нет, из одной ветки можно перейти в другую в обход закрытых ворот.
  for (const pa of index.pieces) {
    if (!/^strip_\d+a$/.test(pa.id)) continue; // полоса ветки A
    const pb = index.pieces.find((q) => q.id === pa.id.replace(/a$/, "b"));
    if (!pb) continue;
    const [ra, rb] = pa.rails;
    for (let i = 0; i < ra.length; i++) {
      for (const t of [0.1, 0.5, 0.9]) {
        const x = ra[i].x + (rb[i].x - ra[i].x) * t;
        const z = ra[i].z + (rb[i].z - ra[i].z) * t;
        check(!insideDeep(pb, x, z, 0.05), `seed ${seed} ${pa.id}/${pb.id}: ветки развилки ПЕРЕСЕКАЮТСЯ у (${x.toFixed(2)},${z.toFixed(2)})`);
      }
    }
  }

  // --- A1/A2: каждый кусок стены стоит на границе и не кусает пол ---
  for (const w of walls) {
    if (w.t < 0.3 - 1e-9) thinCount++;
    const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
    const mid = { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 };
    check(len > 1e-3, `seed ${seed} ${w.pieceId}: вырожденный кусок стены`);
    check(
      index.covers(mid.x - w.n.x * 1e-3, mid.z - w.n.z * 1e-3),
      `seed ${seed} ${w.pieceId}: стена в воздухе — изнутри под ней нет пола (${mid.x.toFixed(2)},${mid.z.toFixed(2)})`
    );
    check(
      !index.covers(mid.x + w.n.x * 1e-3, mid.z + w.n.z * 1e-3),
      `seed ${seed} ${w.pieceId}: ЛИШНЯЯ стена — снаружи неё пол (${mid.x.toFixed(2)},${mid.z.toFixed(2)})`
    );
    let bites = 0;
    for (let k = 0; k < 60; k++) {
      const u = rnd() * len;
      const v = rnd() * w.t;
      const dx = (w.b.x - w.a.x) / len;
      const dz = (w.b.z - w.a.z) / len;
      const px = w.a.x + dx * u + w.n.x * v;
      const pz = w.a.z + dz * u + w.n.z * v;
      // Укус — точка глубже 3 см внутри какого-либо ОДНОГО полигона пола
      // (по объединению нельзя: в узкой щели между ветками оно «смыкается»).
      if (index.pieces.some((q) => insideDeep(q, px, pz, 0.03))) bites++;
    }
    check(bites === 0, `seed ${seed} ${w.pieceId}: тело стены заходит в пол (${mid.x.toFixed(2)},${mid.z.toFixed(2)}), t=${w.t}`);
  }

  // --- A3: нет открытой границы ---
  for (const p of index.pieces) {
    const poly = p.outline;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-6) continue;
      const dx = (b.x - a.x) / len;
      const dz = (b.z - a.z) / len;
      const n = { x: dz, z: -dx };
      for (let s = 0.075; s < len; s += 0.15) {
        const edgePt = { x: a.x + dx * s, z: a.z + dz * s };
        const probe = { x: edgePt.x + n.x * 0.01, z: edgePt.z + n.z * 0.01 };
        if (index.covers(probe.x, probe.z)) continue; // граница закрыта соседним полом
        const protectedByWall = walls.some((w) => {
          const f = wallFrame(w, probe);
          return f.u >= -0.03 && f.u <= f.len + 0.03 && f.v >= -0.03 && f.v <= w.t + 0.03;
        });
        check(
          protectedByWall,
          `seed ${seed} ${p.id}: ДЫРА в границе — край пола без стены в (${edgePt.x.toFixed(2)},${edgePt.z.toFixed(2)})`
        );
      }
    }
  }

  // --- B: растровый игрок ---
  const grid = buildGrid(index.pieces, walls);
  const start = cellOf(grid, { x: world.spawnPoint.x, z: world.spawnPoint.z });
  check(grid.floor[start] === 1 && !grid.blocked[start], `seed ${seed}: спавн не на проходимом полу`);
  const { seen, leaks } = flood(grid, start);
  for (let i = 0; i < grid.floor.length; i++) if (seen[i]) floodCells++;
  check(
    leaks.length === 0,
    `seed ${seed}: игрок может ПРОВАЛИТЬСЯ в бездну, напр. у (${leaks[0] !== undefined ? posOf(grid, leaks[0]).x.toFixed(2) : ""},${leaks[0] !== undefined ? posOf(grid, leaks[0]).z.toFixed(2) : ""})`
  );

  const approach = world.sections.find((s) => s.tier === 0)!;
  const nearTower = localToWorld(approach, 0, approach.length - 1.5);
  check(!!seen[cellOf(grid, nearTower)], `seed ${seed}: до подхода к башне НЕ добраться (проход где-то заперт)`);

  for (const p of index.pieces) {
    if (p.kind === "patch") continue; // узкие заплатки: достижимость проверяет путь через них
    const probe = pieceProbe(p);
    const cell = cellOf(grid, probe);
    check(!!seen[cell], `seed ${seed} ${p.id}: часть мира недостижима/заперта (${probe.x.toFixed(2)},${probe.z.toFixed(2)})`);
  }
}

for (let seed = 1; seed <= SEEDS; seed++) {
  const gs = new GameState();
  const base = generateWorld(gs, seed);
  verifyWorld(seed, "", base);
  // Мир продлевают во время игры (extendWorld): старый подход отбрасывается, на его
  // месте появляются новые секции. Стыки старого хвоста должны стать проходом, а не
  // остаться глухой торцевой стеной подхода. Стример после продления пересоздаётся
  // и строит FootprintIndex по новому массиву секций — проверяем именно такой мир.
  verifyWorld(seed, "extend+", extendWorld(base, gs, 1 + (seed % 3)));
}

check(wallCount > 0 && pieceCount > 0, "тест ничего не проверил");
check(seamWorlds >= SEEDS / 4, `ожидали много миров со схождением веток, нашли ${seamWorlds}`);
check(spurPieces >= SEEDS / 3, `ожидали много ниш, нашли ${spurPieces}`);

console.log(
  `Сидов: ${SEEDS}, полигонов: ${pieceCount}, кусков стены: ${wallCount} (утонч.: ${thinCount}), ниш: ${spurPieces}, миров с развилкой-схождением: ${seamWorlds}, клеток заливки: ${floodCells}`
);
console.log(`Проверок: ${checks}, провалов: ${failures}`);
if (failures > 0) {
  console.error("FAILED: в геометрии пола/стен найдены дыры, лишние куски или заперты проходы");
  process.exit(1);
}
console.log("OK: граница пола закрыта без дыр и без лишних кусков, игрок не проваливается и не заперт");
