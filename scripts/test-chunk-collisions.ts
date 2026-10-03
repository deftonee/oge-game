/**
 * Интеграционная проверка на НАСТОЯЩИХ коллизиях Babylon (NullEngine): собираем
 * чанки целиком (SectionChunk.build) и двигаем коллайдер игрока так же, как
 * PlayerController — moveWithCollisions с эллипсоидом (0.4, 0.9, 0.4).
 *
 *  1. Стены держат: из точки в метре внутри от кусочка стены давим наружу (и под
 *     углом ±30°) — игрок не должен ни выйти за границу пола, ни упасть.
 *  3. Любой кусок пола (в т.ч. заплатки шва, ниши, площадка) держит стоящего игрока.
 *  2. Коридоры проходимы: вдоль оси каждой полосы (секции/ветки) игрок доходит
 *     от начала до конца — внутри пола нет «лишних» стен.
 *
 * test-world-footprint.ts доказывает то же на математике полигонов; этот тест
 * ловит ошибки уже в Babylon-слое: ориентация/слияние боксов, поворот
 * rotation.y, материал/checkCollisions, потеря кусков при слиянии мешей.
 */
import { NullEngine, Scene, MeshBuilder, Vector3 } from "@babylonjs/core";
import { generateWorld } from "../src/world/WorldGenerator";
import { FootprintIndex } from "../src/world/geometry/Footprint";
import { SectionChunk } from "../src/world/SectionChunk";
import { GameState } from "../src/core/GameState";

declare const process: { exit(code?: number): never; env: Record<string, string | undefined> };

const SEEDS = Number(process.env.SEEDS ?? 10);
// ellipsoidOffset=0.9 при высоте эллипсоида 1.8 → на полу position.y ≈ 0. Провал
// сквозь край за 50 кадров по -0.05 уводит y к -2.5, поэтому порог между ними.
const GROUND_MIN_Y = -0.3;
let checks = 0;
let failures = 0;
const MAX_REPORT = 20;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= MAX_REPORT) console.error(`FAIL: ${msg}`);
  }
}

// Сборка чанков печатает логи [stream] — глушим, чтобы тест оставался читаемым.
const realLog = console.log;
console.log = () => {};

const engine = new NullEngine();
let wallsPushed = 0;
let wallsSkipped = 0;
let corridorsWalked = 0;
let floorsStood = 0;

for (let seed = 1; seed <= SEEDS; seed++) {
  const scene = new Scene(engine);
  const gs = new GameState();
  const world = generateWorld(gs, seed);
  // Все ворота открыты: проверяем стены и пол, а не барьеры.
  for (const s of world.sections) for (const g of s.gates) gs.openGate(g.id);

  const index = new FootprintIndex(world.sections);
  for (const s of world.sections) new SectionChunk(scene, s, index).build(gs);
  for (const m of scene.meshes) m.computeWorldMatrix(true);

  // Сущности (ведьмы, костры, мишени, сундуки) не часть проверяемой геометрии.
  let wallMeshes = 0;
  for (const m of scene.meshes) {
    const isGeometry = m.name.startsWith("floor_") || m.name.startsWith("walls_") || m.name.startsWith("wallBox_");
    if (m.name.startsWith("walls_") || m.name.startsWith("wallBox_")) wallMeshes++;
    if (!isGeometry) m.checkCollisions = false;
  }
  check(wallMeshes > 0, `seed ${seed}: чанки не построили ни одного меша стен`);

  const player = MeshBuilder.CreateBox("playerCollider", { width: 0.8, height: 1.8, depth: 0.8 }, scene);
  player.checkCollisions = true;
  player.ellipsoid = new Vector3(0.4, 0.9, 0.4);
  player.ellipsoidOffset = new Vector3(0, 0.9, 0);

  // Без рендер-цикла (NullEngine) Babylon не пересчитывает мировую матрицу сам:
  // коллайдер «видел» бы себя в старой позиции. В игре это делает рендер.
  const move = (dx: number, dy: number, dz: number): void => {
    player.computeWorldMatrix(true);
    player.moveWithCollisions(new Vector3(dx, dy, dz));
  };
  const place = (x: number, z: number): void => {
    player.position.set(x, 1.0, z);
    for (let i = 0; i < 6; i++) move(0, -0.2, 0); // осесть на пол
  };
  const step = (dx: number, dz: number): void => {
    move(dx, -0.05, dz); // как гравитация у PlayerController
  };

  // --- 1. Стены держат ---
  let k = 0;
  for (const s of world.sections) {
    for (const w of index.wallsOf(s)) {
      if (k++ % 4 !== 0) continue; // каждый 4-й кусок — хватает охвата, тест остаётся быстрым
      const mid = { x: (w.a.x + w.b.x) / 2, z: (w.a.z + w.b.z) / 2 };
      const start = { x: mid.x - w.n.x * 1.2, z: mid.z - w.n.z * 1.2 };
      // Старт должен быть на полу с запасом под эллипсоид.
      const roomy = [0, 1, 2, 3, 4, 5, 6, 7].every((i) => {
        const a = (i * Math.PI) / 4;
        return index.covers(start.x + Math.cos(a) * 0.5, start.z + Math.sin(a) * 0.5);
      });
      if (!roomy) {
        wallsSkipped++;
        continue;
      }
      for (const turn of [0, 0.5, -0.5]) {
        place(start.x, start.z);
        const c = Math.cos(turn);
        const sn = Math.sin(turn);
        const dirX = w.n.x * c - w.n.z * sn;
        const dirZ = w.n.x * sn + w.n.z * c;
        for (let i = 0; i < 50; i++) step(dirX * 0.08, dirZ * 0.08);
        const { x, y, z } = player.position;
        check(y > GROUND_MIN_Y, `seed ${seed} ${w.pieceId}: игрок ПРОВАЛИЛСЯ сквозь границу у (${mid.x.toFixed(2)},${mid.z.toFixed(2)}), y=${y.toFixed(2)}`);
        check(
          index.covers(x, z),
          `seed ${seed} ${w.pieceId}: игрок ВЫШЕЛ за границу пола у (${mid.x.toFixed(2)},${mid.z.toFixed(2)}) → (${x.toFixed(2)},${z.toFixed(2)})`
        );
      }
      wallsPushed++;
    }
  }

  // --- 2. Коридоры проходимы по оси ---
  for (const piece of index.pieces) {
    if (piece.kind !== "strip") continue;
    const [ra, rb] = piece.rails;
    const axis = ra.map((p, i) => ({ x: (p.x + rb[i].x) / 2, z: (p.z + rb[i].z) / 2 }));
    // Идём от второй до предпоследней точки оси (концы упираются в ворота/торцы).
    const from = axis[1];
    place(from.x, from.z);
    let reachedAll = true;
    for (let i = 2; i < axis.length - 1 && reachedAll; i++) {
      const target = axis[i];
      for (let n = 0; n < 60; n++) {
        const dx = target.x - player.position.x;
        const dz = target.z - player.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.3) break;
        step((dx / dist) * 0.1, (dz / dist) * 0.1);
      }
      if (Math.hypot(target.x - player.position.x, target.z - player.position.z) > 0.6) reachedAll = false;
    }
    check(reachedAll && player.position.y > GROUND_MIN_Y, `seed ${seed} ${piece.id}: по оси коридора НЕ пройти (упёрлись в лишнюю стену или провалились)`);
    corridorsWalked++;
  }

  // --- 3. По любому куску пола можно СТОЯТЬ (ловит ленты с обратной ориентацией) ---
  for (const piece of index.pieces) {
    const [ra, rb] = piece.rails;
    const k = Math.floor((ra.length - 1) / 2);
    const k2 = Math.min(k + 1, ra.length - 1);
    const probe = {
      x: (ra[k].x + ra[k2].x + rb[k].x + rb[k2].x) / 4,
      z: (ra[k].z + ra[k2].z + rb[k].z + rb[k2].z) / 4,
    };
    place(probe.x, probe.z);
    for (let i = 0; i < 60; i++) step(0, 0);
    check(player.position.y > GROUND_MIN_Y, `seed ${seed} ${piece.id}: пол не держит игрока (y=${player.position.y.toFixed(2)}) у (${probe.x.toFixed(2)},${probe.z.toFixed(2)})`);
    floorsStood++;
  }

  scene.dispose();
}

console.log = realLog;
check(wallsPushed > 100, `протестировано слишком мало кусков стены: ${wallsPushed}`);
console.log(`Сидов: ${SEEDS}, кусков стены продавлено: ${wallsPushed} (пропущено из-за тесноты: ${wallsSkipped}), коридоров пройдено: ${corridorsWalked}, полов проверено на стояние: ${floorsStood}`);
console.log(`Проверок: ${checks}, провалов: ${failures}`);
if (failures > 0) {
  console.error("FAILED: настоящие коллизии пропускают сквозь стены или стены стоят посреди коридора");
  process.exit(1);
}
console.log("OK: стены держат эллипсоид игрока, коридоры проходимы");
