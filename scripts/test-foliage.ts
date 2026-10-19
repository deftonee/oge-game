// Листва (render/foliage): комки лежат внутри габарита стелса и заполняют его,
// клоны независимы по transform/visibility, но делят геометрию и материал;
// интеграция в SectionChunk (кусты, кроны, заросли и их двойники).
import { NullEngine, Scene, VertexBuffer, Mesh } from "@babylonjs/core";
import {
  BUSH_ENVELOPE_RADIUS,
  CANOPY_ENVELOPE_RADIUS,
  ENVELOPE_TOLERANCE,
  FOLIAGE_VARIANTS,
  createBush,
  createCanopy,
  createThicketBase,
  variantKeyAt,
} from "../src/render/foliage";
import { QUALITY_PROFILES, setQualityTier } from "../src/core/quality";
import { generateWorld } from "../src/world/WorldGenerator";
import { FootprintIndex } from "../src/world/geometry/Footprint";
import { SectionChunk } from "../src/world/SectionChunk";
import { GameState } from "../src/core/GameState";

declare const process: { exit(code?: number): never };

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

const realLog = console.log;
console.log = () => {}; // сборка чанков печатает [stream]-логи

const engine = new NullEngine();

function positions(mesh: Mesh): Float32Array {
  return mesh.getVerticesData(VertexBuffer.PositionKind) as Float32Array;
}

/** Максимальный горизонтальный вынос вершин в слое высоты [yLow, yHigh]. */
function reachInBand(mesh: Mesh, yLow: number, yHigh: number): number {
  const pos = positions(mesh);
  let reach = 0;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i + 1] >= yLow && pos[i + 1] <= yHigh) reach = Math.max(reach, Math.hypot(pos[i], pos[i + 2]));
  }
  return reach;
}

for (const tier of ["low", "mid", "high"] as const) {
  setQualityTier(tier);
  const q = QUALITY_PROFILES[tier];
  const scene = new Scene(engine); // набор шаблонов строится на сцену → заново под каждый уровень

  // --- Габарит куста ---------------------------------------------------------
  const E = BUSH_ENVELOPE_RADIUS;
  for (let v = 0; v < FOLIAGE_VARIANTS; v++) {
    // подбираем ключ, дающий вариант v (ключ → вариант детерминирован, проверим ниже)
    const bush = createBush(scene, `probe_bush_${v}`, v * 101 + 7);
    const pos = positions(bush);
    const colors = bush.getVerticesData(VertexBuffer.ColorKind);
    const n = pos.length / 3;

    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      minY = Math.min(minY, pos[i + 1]);
      maxY = Math.max(maxY, pos[i + 1]);
    }
    check(Array.from(pos).every(Number.isFinite), `${tier}/куст${v}: нет NaN в позициях`);
    let maxHoriz = 0;
    for (let i = 0; i < pos.length; i += 3) maxHoriz = Math.max(maxHoriz, Math.hypot(pos[i], pos[i + 2]));
    check(maxHoriz <= E * ENVELOPE_TOLERANCE, `${tier}/куст${v}: по горизонтали внутри круга укрытия (${maxHoriz.toFixed(2)} ≤ ${(E * ENVELOPE_TOLERANCE).toFixed(2)})`);
    check(maxY <= E * ENVELOPE_TOLERANCE, `${tier}/куст${v}: не выше габарита (${maxY.toFixed(2)})`);
    check(Math.abs(minY + E) < 0.01, `${tier}/куст${v}: куст стоит ровно на земле (низ ${minY.toFixed(3)} при ${-E})`);
    check(maxY >= E * 0.85, `${tier}/куст${v}: куст достаточно высок (верх ${maxY.toFixed(2)})`);
    check(!!colors && colors.length === n * 4 && Array.from(colors).every((c) => c >= 0 && c <= 1), `${tier}/куст${v}: у каждой вершины цвет в [0,1]`);

    // На высоте глаз (1.4 м) визуал должен занимать то же, что считает стелс: [0.8…1.06] логического радиуса.
    const s = 0.9;
    const yEye = (1.4 - E * s) / s;
    const logical = Math.sqrt(E * E - yEye * yEye);
    const reach = reachInBand(bush, yEye - 0.15, yEye + 0.15);
    check(reach >= logical * 0.8, `${tier}/куст${v}: на уровне глаз куст заполняет габарит (${reach.toFixed(2)} ≥ ${(logical * 0.8).toFixed(2)})`);
    check(reach <= logical * ENVELOPE_TOLERANCE, `${tier}/куст${v}: на уровне глаз куст не выступает за габарит (${reach.toFixed(2)})`);

    const detailFaces = q.foliageDetail === 1 ? 20 : 80;
    check(bush.getTotalIndices() / 3 === q.bushBlobs * detailFaces, `${tier}/куст${v}: ${bush.getTotalIndices() / 3} граней = ${q.bushBlobs} комков × ${detailFaces}`);
  }

  // --- Габарит кроны ---------------------------------------------------------
  const C = CANOPY_ENVELOPE_RADIUS;
  for (let v = 0; v < FOLIAGE_VARIANTS; v++) {
    const canopy = createCanopy(scene, `probe_canopy_${v}`, v * 101 + 7);
    const pos = positions(canopy);
    let maxR = 0;
    for (let i = 0; i < pos.length; i += 3) maxR = Math.max(maxR, Math.hypot(pos[i], pos[i + 1], pos[i + 2]));
    check(maxR <= C * ENVELOPE_TOLERANCE, `${tier}/крона${v}: вершины внутри габарита (${maxR.toFixed(2)} ≤ ${(C * ENVELOPE_TOLERANCE).toFixed(2)})`);
    check(maxR >= C * 0.85, `${tier}/крона${v}: крона заполняет габарит (${maxR.toFixed(2)})`);
    const detailFaces = q.foliageDetail === 1 ? 20 : 80;
    check(canopy.getTotalIndices() / 3 === q.canopyBlobs * detailFaces, `${tier}/крона${v}: ${canopy.getTotalIndices() / 3} граней = ${q.canopyBlobs} × ${detailFaces}`);
  }

  // --- Клоны: независимы, но делят геометрию и материал ------------------------
  const geometriesBefore = scene.geometries.length;
  const a = createBush(scene, "clone_a", variantKeyAt(1, 2));
  const b = createBush(scene, "clone_b", variantKeyAt(1, 2));
  const c = createBush(scene, "clone_c", variantKeyAt(1, 2));
  check(scene.geometries.length === geometriesBefore, `${tier}: клоны не плодят геометрию`);
  check(a.material === b.material && b.material === c.material && !!a.material, `${tier}: у клонов общий материал`);
  check(a.isEnabled() && a.isVisible && a.isPickable === false, `${tier}: клон включён, видим и не pickable`);
  a.visibility = 0.3;
  a.position.set(5, 1, 5);
  check(b.visibility === 1 && b.position.x === 0, `${tier}: visibility и transform клонов независимы`);
  check(scene.getMeshByName("clone_a") === a, `${tier}: клон находится по имени (контракт стелса)`);

  const sameKey = createBush(scene, "same_key", variantKeyAt(1, 2));
  check(sameKey.getTotalVertices() === a.getTotalVertices() && positions(sameKey)[1] === positions(a)[1], `${tier}: один ключ — один вариант`);
  const variantSigs = new Set<number>();
  for (let i = 0; i < 40; i++) variantSigs.add(positions(createBush(scene, `v${i}`, variantKeyAt(i * 3.7, i * 1.3)))[4]);
  check(variantSigs.size === FOLIAGE_VARIANTS, `${tier}: ключи по позиции дают все ${FOLIAGE_VARIANTS} варианта (${variantSigs.size})`);

  // --- Основа зарослей ---------------------------------------------------------
  const thicket = createThicketBase(scene, "thicket_base", 3);
  check(thicket.isVisible === false && thicket.isEnabled(), `${tier}: основа зарослей невидима, но включена (рисуются инстансы)`);
  const inst = thicket.createInstance("thicket_inst");
  check(inst.sourceMesh === thicket, `${tier}: инстанс зарослей ссылается на основу`);

  // --- Шаблоны не рисуются ------------------------------------------------------
  const templates = scene.meshes.filter((m) => m.name.startsWith("foliage_"));
  check(templates.length === FOLIAGE_VARIANTS * 3, `${tier}: шаблонов ${FOLIAGE_VARIANTS}×3 (${templates.length})`);
  check(templates.every((m) => !m.isEnabled()), `${tier}: шаблоны выключены и не попадают в кадр`);

  // --- Интеграция: настоящий чанк ------------------------------------------------
  const gs = new GameState();
  const world = generateWorld(gs, 11);
  const index = new FootprintIndex(world.sections);
  const spec = world.sections.find((s2) => s2.bushes.length > 0 && s2.trees.length > 0)!;
  const chunkScene = scene;
  const before = chunkScene.materials.length;
  const chunk = new SectionChunk(chunkScene, spec, index);
  chunk.build(gs);

  const bushes = chunkScene.meshes.filter((m) => m.name.startsWith(`bush_${spec.index}_`));
  check(bushes.length === spec.bushes.length, `${tier}: кустов в сцене = кустов в spec (${bushes.length})`);
  check(bushes.every((m) => m.material === a.material), `${tier}: кусты чанка на общем материале`);
  const canopies = chunkScene.meshes.filter((m) => m.name.startsWith(`treeCanopy_${spec.index}_`));
  check(canopies.length === spec.trees.length, `${tier}: крон = деревьев (${canopies.length})`);
  check(canopies.every((m) => m.material === a.material), `${tier}: кроны на общем материале`);
  const added = chunkScene.materials.slice(before).map((m) => m.name);
  check(!added.some((n) => /^(bush|treeCanopy)Mat/.test(n)), `${tier}: на кусты и кроны чанк не заводит свои материалы`);

  chunk.dispose();
  check(!chunkScene.meshes.some((m) => m.name.startsWith(`bush_${spec.index}_`) || m.name.startsWith(`treeCanopy_${spec.index}_`)), `${tier}: после dispose кустов и крон нет`);
  check(templates.every((m) => !m.isDisposed()) && chunkScene.materials.includes(a.material!), `${tier}: шаблоны и общий материал пережили dispose чанка`);
  scene.dispose();
}

console.log = realLog;
if (failures > 0) {
  console.error(`\n${failures} из ${checks} проверок не прошли`);
  process.exit(1);
}
console.log(`OK: листва прошла ${checks} проверок`);
