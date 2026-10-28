/**
 * Окружения мира (биомы): назначение по школе ворот, раскладка школьного класса
 * и его сборка на настоящем Babylon (NullEngine).
 *
 *  1. Данные: у школы грозы biome="classroom", у школы пламени — "steampunk", у остальных — поле.
 *  2. Назначение (на сидах): секция получает биом школы ворот ПЕРЕД собой; ветки —
 *     биом СВОИХ ворот; схождение — общий биом веток, иначе поле; первая секция и
 *     подход к башне — всегда поле; цвет пола соответствует биому.
 *  3. Раскладка класса (чистая функция): детерминирована; парты/столы/шкафы не
 *     налезают друг на друга, на сущности, вход, выход с воротами и проёмы ниш.
 *  4. Сборка: класс строится без исключений, укрытия (кусты/шкафы) на месте,
 *     твёрдые предметы действительно держат игрока (moveWithCollisions), а после
 *     dispose в сцене не остаётся мебели (шаблоны на сцену живут дальше).
 */
import { NullEngine, Scene, MeshBuilder, Vector3, Mesh } from "@babylonjs/core";
import { GameState } from "../src/core/GameState";
import { getSchoolById } from "../src/data/spells";
import { generateWorld } from "../src/world/WorldGenerator";
import type { SectionSpec } from "../src/world/spec/SectionSpec";
import { FootprintIndex } from "../src/world/geometry/Footprint";
import { localToWorld, yawAt } from "../src/world/geometry/SectionGeometry";
import { SectionChunk } from "../src/world/SectionChunk";
import { applyBiome, biomeOfSchool, floorColorOf, getBiome, isBiomeId, BIOME_IDS, DEFAULT_BIOME } from "../src/world/biomes/biomes";
import { APPROACH_COLOR } from "../src/world/generation/WorldGenConfig";
import {
  BENCH,
  CLEAR,
  DESK,
  DESK_RADIUS,
  DESK_WALL_MARGIN,
  ENTRANCE_CLEAR,
  EXIT_CLEAR,
  WALL_END_CLEAR,
  layoutClassroom,
} from "../src/world/biomes/classroom/layout";
import { classroomFloorTexture } from "../src/world/biomes/classroom/textures";
import { classroomKit } from "../src/world/biomes/classroom/models";
import { scaled } from "./lib/testScale";

declare const process: { exit(code?: number): never };

let failures = 0;
let checks = 0;
const MAX_REPORT = 25;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= MAX_REPORT) console.error(`FAIL: ${msg}`);
  }
}

// Сборка мира и чанков печатает логи — глушим, чтобы вывод теста оставался читаемым.
const realLog = console.log;
console.log = () => {};

// ---------- 1. Данные ----------

check(isBiomeId("classroom") && isBiomeId("meadow") && !isBiomeId("lava") && !isBiomeId(undefined), "isBiomeId различает известные id");
check(BIOME_IDS.includes(DEFAULT_BIOME), "биом по умолчанию — известный");
check(getSchoolById("storm").biome === "classroom", "школа грозы (электродинамика) — окружение «класс»");
check(biomeOfSchool("storm") === "classroom", "biomeOfSchool(storm) = classroom");
check(getSchoolById("fire").biome === "steampunk" && biomeOfSchool("fire") === "steampunk", "школа пламени (термодинамика) — окружение «стимпанк»");
check(biomeOfSchool("earth") === "meadow", "школа земли — поле");
check(biomeOfSchool(null) === "meadow" && biomeOfSchool(undefined) === "meadow", "ворота без школы — поле");
check(getBiome("classroom").grass === false && getBiome("meadow").grass === true, "трава только в поле");
check(floorColorOf("classroom", 1) !== floorColorOf("classroom", 3), "пол класса различается по сложности");
check(floorColorOf("classroom", 99) === floorColorOf("classroom", 3), "неизвестный tier — как самый сложный");

// ---------- 2. Назначение на сидах ----------

const GEN_SEEDS = scaled(40, 200);
let worldsWithClass = 0;
let classSections = 0;
let sectionsTotal = 0;
let branchClass = 0;

for (let seed = 1; seed <= GEN_SEEDS; seed++) {
  const world = generateWorld(new GameState(), seed);
  const secs = world.sections;
  let hasClass = false;
  const trunkBefore = (s: SectionSpec): SectionSpec | undefined => secs.find((t) => t.index === s.index - 1 && !t.forkBranch);

  for (const s of secs) {
    sectionsTotal++;
    if (s.biome === "classroom") {
      classSections++;
      hasClass = true;
      if (s.forkBranch) branchClass++;
    }
    const tag = `seed ${seed} #${s.index}${s.forkBranch ?? ""}`;
    check(isBiomeId(s.biome), `${tag}: биом назначен (${String(s.biome)})`);

    if (s.tier === 0) {
      check(s.biome === "meadow" && s.color === APPROACH_COLOR, `${tag}: подход к башне — поле и свой цвет`);
      continue;
    }
    check(s.color === floorColorOf(s.biome, s.tier), `${tag}: цвет пола соответствует биому «${s.biome}» и сложности ${s.tier}`);

    if (s.forkBranch) {
      const parent = secs.find((t) => t.index === s.forkParentIndex && !t.forkBranch)!;
      const gate = parent.gates.find((g) => g.id === s.forkGateId);
      check(!!gate, `${tag}: ворота ветки найдены у родителя`);
      if (gate) check(s.biome === biomeOfSchool(gate.schoolId), `${tag}: ветка получает биом школы своих ворот (${gate.schoolId})`);
      continue;
    }

    const branches = secs.filter((b) => b.forkBranch && b.index === s.index - 1);
    if (branches.length === 2) {
      const expected = branches[0].biome === branches[1].biome ? branches[0].biome : DEFAULT_BIOME;
      check(s.biome === expected, `${tag}: схождение — общий биом веток или поле`);
      continue;
    }

    if (s.index === 0 || secs[0] === s) {
      check(s.biome === "meadow", `${tag}: первая секция — поле (мягкий вход)`);
      continue;
    }
    const prev = trunkBefore(s);
    check(!!prev, `${tag}: найдена предыдущая стволовая секция`);
    if (prev) {
      const expected = prev.gates.length === 1 ? biomeOfSchool(prev.gates[0].schoolId) : prev.biome;
      check(s.biome === expected, `${tag}: биом = школа ворот перед секцией (${prev.gates[0]?.schoolId ?? "нет ворот"} → ${expected}), а не ${s.biome}`);
    }
  }
  if (hasClass) worldsWithClass++;
}
check(classSections > 0, `за ${GEN_SEEDS} сидов не появилось ни одной секции-класса`);
check(worldsWithClass >= Math.floor(GEN_SEEDS * 0.5), `класс должен встречаться в большинстве миров: ${worldsWithClass}/${GEN_SEEDS}`);
check(classSections < sectionsTotal, "не все секции — классы");
check(branchClass > 0, "класс встречается и в ветках развилок (выбор ворот = выбор окружения)");

// Детерминизм: тот же seed → тот же мир, включая биомы.
{
  const a = generateWorld(new GameState(), 7);
  const b = generateWorld(new GameState(), 7);
  check(JSON.stringify(a.sections) === JSON.stringify(b.sections), "мир с биомами детерминирован по seed");
}

// ---------- 3. Раскладка класса (чистая функция) ----------

const LAYOUT_SEEDS = scaled(15, 60);
let desksSeen = 0;
let wallItemsSeen = 0;
let cabinetsSeen = 0;

/** Все секции мира, принудительно переведённые в класс (чтобы раскладка проверялась на любых формах). */
function forcedClassWorld(seed: number): SectionSpec[] {
  const world = generateWorld(new GameState(), seed);
  for (const s of world.sections) if (s.tier > 0) applyBiome(s, "classroom");
  return world.sections.filter((s) => s.tier > 0);
}

for (let seed = 1; seed <= LAYOUT_SEEDS; seed++) {
  for (const s of forcedClassWorld(seed)) {
    const tag = `seed ${seed} #${s.index}${s.forkBranch ?? ""}`;
    const layout = layoutClassroom(s);
    check(JSON.stringify(layout) === JSON.stringify(layoutClassroom(s)), `${tag}: раскладка детерминирована`);
    const half = s.width / 2;

    const discs = [
      ...s.witches.map((p) => ({ ...p, r: CLEAR.witch })),
      ...s.bonfires.map((p) => ({ ...p, r: CLEAR.bonfire })),
      ...s.chests.map((p) => ({ ...p, r: CLEAR.chest })),
      ...s.practiceTargets.map((p) => ({ ...p, r: CLEAR.target })),
      ...s.bushes.map((p) => ({ ...p, r: CLEAR.bush * p.scale })),
      ...s.trees.map((p) => ({ ...p, r: CLEAR.tree })),
    ];
    const inSpurMouth = (x: number, z: number, side?: "left" | "right"): boolean =>
      s.sideSpurs.some((sp) => (side ? sp.side === side : sp.side === "right" ? x > half - 7 : x < -(half - 7)) && Math.abs(z - sp.doorZ) < sp.width / 2 + 2);

    // Парты.
    desksSeen += layout.desks.length;
    layout.desks.forEach((d, i) => {
      const where = `${tag} парта #${i} (${d.x.toFixed(1)},${d.z.toFixed(1)})`;
      check(Math.abs(d.x) <= half - DESK_WALL_MARGIN + 0.3, `${where}: слишком близко к стене`);
      check(d.z >= ENTRANCE_CLEAR && d.z <= s.length - EXIT_CLEAR + 0.2, `${where}: на входе или перед воротами`);
      check(!discs.some((o) => Math.hypot(d.x - o.x, d.z - o.z) < o.r + DESK_RADIUS - 0.35), `${where}: налезает на сущность`);
      check(!inSpurMouth(d.x, d.z), `${where}: загораживает проём ниши`);
      for (let j = 0; j < i; j++) {
        const o = layout.desks[j];
        check(Math.hypot(d.x - o.x, d.z - o.z) >= DESK.w, `${where}: пересекается с партой #${j}`);
      }
    });

    // Мебель у стен.
    wallItemsSeen += layout.wall.length;
    layout.wall.forEach((it, i) => {
      const where = `${tag} у стены ${it.side} #${i} ${it.kind}`;
      check(it.z - it.length / 2 >= 1.5 && it.z + it.length / 2 <= s.length - WALL_END_CLEAR + 0.01, `${where}: выходит за пределы секции или закрывает ворота`);
      check(
        !s.sideSpurs.some((sp) => sp.side === it.side && Math.abs(it.z - sp.doorZ) < sp.width / 2 + it.length / 2),
        `${where}: закрывает проём ниши`
      );
      const wallX = it.side === "right" ? half : -half;
      check(
        !discs.some((o) => Math.hypot(Math.max(0, Math.abs(o.x - wallX) - BENCH.depth), Math.max(0, Math.abs(o.z - it.z) - it.length / 2)) < o.r - 0.01),
        `${where}: стоит на личном пространстве сущности`
      );
      layout.wall.forEach((o, j) => {
        if (j >= i || o.side !== it.side) return;
        check(Math.abs(o.z - it.z) >= (o.length + it.length) / 2 - 1e-6, `${where}: пересекается с соседним предметом #${j}`);
      });
    });

    // Шкафы — ровно на месте деревьев.
    cabinetsSeen += layout.cabinets.length;
    check(layout.cabinets.length === s.trees.length, `${tag}: шкафов столько же, сколько деревьев-укрытий`);
    layout.cabinets.forEach((c, i) => {
      check(c.x === s.trees[i].x && c.z === s.trees[i].z, `${tag}: шкаф #${i} стоит на месте дерева`);
      check([0, 1, 2, 3].includes(c.quarterTurns), `${tag}: шкаф повёрнут кратно 90°`);
    });
  }
}
check(desksSeen > LAYOUT_SEEDS * 5, `парт слишком мало: ${desksSeen}`);
check(wallItemsSeen > LAYOUT_SEEDS * 5, `мебели у стен слишком мало: ${wallItemsSeen}`);
check(cabinetsSeen > 0, "шкафов нет вообще");

// ---------- 4. Сборка на Babylon (NullEngine) ----------

const engine = new NullEngine();
const BUILD_SEEDS = scaled(3, 12);
let chunksBuilt = 0;
let desksBlocked = 0;
let texturedFloors = 0;
const FURNITURE = /^(desk_|bench_|board_|shelf_|cabinet_|pot_|classroomCol_|treeCol_|bush_)/;

for (let seed = 1; seed <= BUILD_SEEDS; seed++) {
  const gs = new GameState();
  const world = generateWorld(gs, seed);
  const target = world.sections.find((s) => s.tier > 0 && !s.forkBranch && s.width >= 20 && s.length >= 36);
  if (!target) continue;
  applyBiome(target, "classroom");
  const tag = `seed ${seed} #${target.index}`;
  const layout = layoutClassroom(target);

  const scene = new Scene(engine);
  const baseline = scene.meshes.length;
  const index = new FootprintIndex([target]);
  const chunk = new SectionChunk(scene, target, index);
  chunk.build(gs);
  chunksBuilt++;
  for (const m of scene.meshes) m.computeWorldMatrix(true);

  // Укрытия на месте: кусты → растения, деревья → шкафы.
  check(chunk.bushVolumes.length === target.bushes.length, `${tag}: растений-укрытий ${chunk.bushVolumes.length} ≠ кустов ${target.bushes.length}`);
  check(chunk.treeVolumes.length === target.trees.length, `${tag}: шкафов-укрытий ${chunk.treeVolumes.length} ≠ деревьев ${target.trees.length}`);
  for (const t of chunk.treeVolumes) {
    check(t.canopy instanceof Mesh && t.canopy.isEnabled() && t.blockRadius > 0.3, `${tag}: шкаф — настоящий меш с радиусом обзора`);
    t.canopy.visibility = 0.3;
    check(t.canopy.visibility === 0.3, `${tag}: шкаф прозрачнеет независимо от других`);
    t.canopy.visibility = 1;
  }
  for (const b of chunk.bushVolumes) {
    b.setAlpha(0.4);
    check(b.mesh.visibility === 0.4 && b.blockRadius > 0.3 && b.blockRadius <= b.radius + 1e-6, `${tag}: растение-укрытие работает как куст`);
    b.setAlpha(1);
  }

  // Контракт укрытий — как в поле: кусты называются bush_*, у каждого шкафа есть свой невидимый treeCol_* в его позиции.
  check(chunk.bushVolumes.every((b) => b.mesh.name.startsWith("bush_") && scene.getMeshByName(b.mesh.name) === b.mesh), `${tag}: растения-укрытия — меши bush_*`);
  check(
    chunk.treeVolumes.every((t) => scene.meshes.some((m) => m.name.startsWith("treeCol_") && Math.hypot(m.position.x - t.x, m.position.z - t.z) < 1e-6 && m.checkCollisions && !m.isVisible)),
    `${tag}: у каждого шкафа есть невидимый коллайдер treeCol_*`
  );

  // Один слитый коллайдер, мебель отдельными мешами, шаблоны выключены.
  const colliders = scene.meshes.filter((m) => m.name.startsWith("classroomCol_"));
  check(colliders.length === 1 && colliders[0].checkCollisions && !colliders[0].isVisible, `${tag}: один невидимый коллайдер мебели на секцию`);
  check(scene.meshes.some((m) => m.name.startsWith("desk_")) === layout.desks.length > 0, `${tag}: парты построены`);
  const kit = classroomKit(scene);
  check([...kit.desks, ...kit.benches, kit.board, kit.cabinet, kit.rack, kit.pot].every((m) => !m.isEnabled()), `${tag}: шаблоны мебели выключены`);
  check(!scene.meshes.some((m) => m.name.startsWith("grass_")), `${tag}: в классе трава не растёт`);

  // Пол: плитка (если есть canvas) или однотонный — но пол в любом случае есть и держит.
  const floors = scene.meshes.filter((m) => m.name.startsWith("floor_"));
  check(floors.length > 0, `${tag}: есть пол`);
  if (classroomFloorTexture(scene)) {
    texturedFloors++;
    check(floors.every((f) => !!(f.material as { diffuseTexture?: unknown } | null)?.diffuseTexture), `${tag}: полы выложены плиткой`);
  }

  // Твёрдость: игрок упирается в парты, а без коллайдера проходит насквозь (контроль теста).
  for (const m of scene.meshes) {
    const isGeometry = m.name.startsWith("floor_") || m.name.startsWith("walls_") || m.name.startsWith("wallBox_") || m.name.startsWith("classroomCol_");
    if (!isGeometry) m.checkCollisions = false;
  }
  const player = MeshBuilder.CreateBox("playerCollider", { width: 0.8, height: 1.8, depth: 0.8 }, scene);
  player.checkCollisions = true;
  player.ellipsoid = new Vector3(0.4, 0.9, 0.4);
  player.ellipsoidOffset = new Vector3(0, 0.9, 0);
  const move = (dx: number, dy: number, dz: number): void => {
    player.computeWorldMatrix(true);
    player.moveWithCollisions(new Vector3(dx, dy, dz));
  };
  const walkAcross = (cx: number, cz: number, dirX: number, dirZ: number): number => {
    player.position.set(cx - dirX * 1.9, 1.0, cz - dirZ * 1.9);
    for (let i = 0; i < 6; i++) move(0, -0.2, 0);
    for (let i = 0; i < 60; i++) move(dirX * 0.08, -0.05, dirZ * 0.08);
    return (player.position.x - cx) * dirX + (player.position.z - cz) * dirZ; // >0 — прошёл дальше центра парты
  };
  // Берём парты, до которых от старта (в метре от левого соседа) есть свободный проход.
  const probe = layout.desks.slice(0, 3);
  for (const d of probe) {
    const w = localToWorld(target, d.x, d.z);
    const yaw = yawAt(target, d.z) + d.yawJitter; // направление «поперёк коридора» вдоль длинной стороны парты
    const dirX = Math.cos(yaw);
    const dirZ = -Math.sin(yaw);
    const blocked = walkAcross(w.x, w.z, dirX, dirZ);
    colliders[0].checkCollisions = false;
    const free = walkAcross(w.x, w.z, dirX, dirZ);
    colliders[0].checkCollisions = true;
    check(free > 0.5, `${tag}: контроль — без коллайдера игрок проходит парту насквозь (${free.toFixed(2)})`);
    check(blocked < 0, `${tag}: парта (${d.x.toFixed(1)},${d.z.toFixed(1)}) не держит игрока (${blocked.toFixed(2)})`);
    if (blocked < 0) desksBlocked++;
  }

  // Освобождение: мебели не остаётся, шаблоны и текстуры на сцену — остаются.
  chunk.dispose();
  const leftovers = scene.meshes.filter((m) => FURNITURE.test(m.name));
  check(leftovers.length === 0, `${tag}: после dispose осталась мебель: ${leftovers.map((m) => m.name).slice(0, 5).join(", ")}`);
  check(scene.getMeshByName("classroom_desk_0") !== null, `${tag}: шаблоны мебели живут вместе со сценой`);
  check(scene.meshes.length >= baseline, `${tag}: счётчик мешей не уходит ниже исходного`);
  scene.dispose();
}
check(chunksBuilt > 0, "ни одного класса не собрано на Babylon");

// Поле собирается по-прежнему и без мебели.
{
  const gs = new GameState();
  const world = generateWorld(gs, 3);
  const meadow = world.sections.find((s) => s.tier > 0 && s.biome === "meadow")!;
  const scene = new Scene(engine);
  const chunk = new SectionChunk(scene, meadow, new FootprintIndex([meadow]));
  chunk.build(gs);
  check(scene.meshes.some((m) => m.name.startsWith("grass_")), "поле: трава на месте");
  check(!scene.meshes.some((m) => FURNITURE.test(m.name) || m.name.startsWith("classroom_")), "поле: никакой мебели класса");
  chunk.dispose();
  scene.dispose();
}

console.log = realLog;
console.log(`классов в мирах: ${classSections}/${sectionsTotal} секций (${worldsWithClass}/${GEN_SEEDS} миров), парт ${desksSeen}, предметов у стен ${wallItemsSeen}, шкафов ${cabinetsSeen}; собрано чанков ${chunksBuilt}, плиточных полов ${texturedFloors}, парт проверено на твёрдость ${desksBlocked}`);
if (failures > 0) {
  console.error(`\n${failures} из ${checks} проверок не прошли`);
  process.exit(1);
}
console.log(`OK: окружения мира — ${checks} проверок (назначение по воротам, раскладка класса, сборка, коллизии)`);
