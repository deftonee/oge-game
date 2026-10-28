/**
 * Окружение «стимпанк» (термодинамика): назначение по школе ворот, раскладка цеха,
 * габариты моделей и сборка на настоящем Babylon (NullEngine).
 *
 *  1. Назначение (на сидах): за воротами школы пламени начинается стимпанк, цвет пола
 *     соответствует биому; цех встречается и в ветках развилок. Общие правила
 *     назначения (ворота → биом, схождение, подход) проверяет test-biomes.ts.
 *  2. Раскладка (чистая функция): детерминирована; реквизит/машины/баки/укрытия не налезают
 *     друг на друга, на сущности, вход, выход с воротами и проёмы ниш.
 *  3. Модели: умещаются в свои габариты — ничего не торчит в стену и выше стен, облако пара
 *     помещается в сферу куста-укрытия, на стене нет «висящих в воздухе» деталей.
 *  4. Сборка: цех строится без исключений, укрытия (облака пара и котлы) на месте и работают
 *     как кусты/деревья, твёрдые предметы действительно держат игрока (moveWithCollisions),
 *     а после dispose в сцене не остаётся предметов (шаблоны на сцену живут дальше).
 */
import { NullEngine, Scene, MeshBuilder, Vector3, Mesh } from "@babylonjs/core";
import { GameState } from "../src/core/GameState";
import { generateWorld } from "../src/world/WorldGenerator";
import type { SectionSpec } from "../src/world/spec/SectionSpec";
import { FootprintIndex } from "../src/world/geometry/Footprint";
import { localToWorld, yawAt } from "../src/world/geometry/SectionGeometry";
import { SectionChunk } from "../src/world/SectionChunk";
import { applyBiome, biomeOfSchool, floorColorOf, getBiome } from "../src/world/biomes/biomes";
import { BUSH_ENVELOPE_RADIUS } from "../src/render/foliage";
import {
  BOILER,
  CLEAR,
  MACHINE,
  PLAQUE,
  PIPES,
  PORTHOLE,
  PROP,
  PROP_RADIUS,
  PROP_WALL_MARGIN,
  ENTRANCE_CLEAR,
  EXIT_CLEAR,
  TANK,
  TOWER,
  WALL_END_CLEAR,
  WALL_GEAR,
  layoutSteampunk,
} from "../src/world/biomes/steampunk/layout";
import { steampunkFloorTexture } from "../src/world/biomes/steampunk/textures";
import { steampunkKit } from "../src/world/biomes/steampunk/models";
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

// ---------- 1. Назначение на сидах ----------

check(getBiome("steampunk").grass === false, "в стимпанке трава не растёт");
check(floorColorOf("steampunk", 1) !== floorColorOf("steampunk", 3), "пол стимпанка различается по сложности");
check(floorColorOf("steampunk", 99) === floorColorOf("steampunk", 3), "неизвестный tier — как самый сложный");
check(floorColorOf("steampunk", 2) !== floorColorOf("classroom", 2), "пол стимпанка отличается от пола класса");
check(biomeOfSchool("fire") === "steampunk", "biomeOfSchool(fire) = steampunk");

const GEN_SEEDS = scaled(40, 200);
let worldsWithSteam = 0;
let steamSections = 0;
let sectionsTotal = 0;
let branchSteam = 0;
for (let seed = 1; seed <= GEN_SEEDS; seed++) {
  const world = generateWorld(new GameState(), seed);
  let has = false;
  for (const s of world.sections) {
    sectionsTotal++;
    if (s.biome !== "steampunk") continue;
    has = true;
    steamSections++;
    if (s.forkBranch) branchSteam++;
    check(s.color === floorColorOf("steampunk", s.tier), `seed ${seed} #${s.index}: цвет пола стимпанка соответствует сложности ${s.tier}`);
  }
  if (has) worldsWithSteam++;
}
check(steamSections > 0, `за ${GEN_SEEDS} сидов не появилось ни одной секции-цеха`);
check(worldsWithSteam >= Math.floor(GEN_SEEDS * 0.5), `цех должен встречаться в большинстве миров: ${worldsWithSteam}/${GEN_SEEDS}`);
check(steamSections < sectionsTotal, "не все секции — цеха");
check(branchSteam > 0, "цех встречается и в ветках развилок (выбор ворот = выбор окружения)");

// ---------- 2. Раскладка цеха (чистая функция) ----------

const LAYOUT_SEEDS = scaled(15, 60);
let propsSeen = 0;
let wallItemsSeen = 0;
let coverSeen = 0;
const kindsSeen = new Set<string>();
const propVariants = new Set<number>();

/** Все секции мира, принудительно переведённые в стимпанк (чтобы раскладка проверялась на любых формах). */
function forcedWorld(seed: number): SectionSpec[] {
  const world = generateWorld(new GameState(), seed);
  for (const s of world.sections) if (s.tier > 0) applyBiome(s, "steampunk");
  return world.sections.filter((s) => s.tier > 0);
}

for (let seed = 1; seed <= LAYOUT_SEEDS; seed++) {
  for (const s of forcedWorld(seed)) {
    const tag = `seed ${seed} #${s.index}${s.forkBranch ?? ""}`;
    const layout = layoutSteampunk(s);
    check(JSON.stringify(layout) === JSON.stringify(layoutSteampunk(s)), `${tag}: раскладка детерминирована`);
    const half = s.width / 2;

    const discs = [
      ...s.witches.map((p) => ({ ...p, r: CLEAR.witch })),
      ...s.bonfires.map((p) => ({ ...p, r: CLEAR.bonfire })),
      ...s.chests.map((p) => ({ ...p, r: CLEAR.chest })),
      ...s.practiceTargets.map((p) => ({ ...p, r: CLEAR.target })),
      ...s.bushes.map((p) => ({ ...p, r: CLEAR.bush * p.scale })),
      ...s.trees.map((p) => ({ ...p, r: CLEAR.tree })),
    ];
    const inSpurMouth = (x: number, z: number): boolean =>
      s.sideSpurs.some((sp) => (sp.side === "right" ? x > half - 7 : x < -(half - 7)) && Math.abs(z - sp.doorZ) < sp.width / 2 + 2);

    // Напольный реквизит.
    propsSeen += layout.props.length;
    layout.props.forEach((p, i) => {
      propVariants.add(p.variant);
      const where = `${tag} реквизит #${i} (${p.x.toFixed(1)},${p.z.toFixed(1)})`;
      check(Math.abs(p.x) <= half - PROP_WALL_MARGIN + 0.5, `${where}: слишком близко к стене`);
      check(p.z >= ENTRANCE_CLEAR && p.z <= s.length - EXIT_CLEAR + 0.4, `${where}: на входе или перед воротами`);
      check(p.variant >= 0 && p.variant <= 3, `${where}: неизвестный вид ${p.variant}`);
      check(!discs.some((o) => Math.hypot(p.x - o.x, p.z - o.z) < o.r + PROP_RADIUS - 0.35), `${where}: налезает на сущность`);
      check(!inSpurMouth(p.x, p.z), `${where}: загораживает проём ниши`);
      for (let j = 0; j < i; j++) {
        const o = layout.props[j];
        check(Math.hypot(p.x - o.x, p.z - o.z) >= PROP.w, `${where}: пересекается с реквизитом #${j}`);
      }
    });

    // Предметы у стен.
    wallItemsSeen += layout.wall.length;
    layout.wall.forEach((it, i) => {
      kindsSeen.add(it.kind);
      const where = `${tag} у стены ${it.side} #${i} ${it.kind}`;
      check(it.z - it.length / 2 >= 1.5 && it.z + it.length / 2 <= s.length - WALL_END_CLEAR + 0.01, `${where}: выходит за пределы секции или закрывает ворота`);
      check(!s.sideSpurs.some((sp) => sp.side === it.side && Math.abs(it.z - sp.doorZ) < sp.width / 2 + it.length / 2), `${where}: закрывает проём ниши`);
      check((it.kind === "machine") === (it.decor !== "none"), `${where}: декор над машиной есть только у машин`);
      const wallX = it.side === "right" ? half : -half;
      check(
        !discs.some((o) => Math.hypot(Math.max(0, Math.abs(o.x - wallX) - TANK.depth), Math.max(0, Math.abs(o.z - it.z) - it.length / 2)) < o.r - 0.01),
        `${where}: стоит на личном пространстве сущности`
      );
      layout.wall.forEach((o, j) => {
        if (j >= i || o.side !== it.side) return;
        check(Math.abs(o.z - it.z) >= (o.length + it.length) / 2 - 1e-6, `${where}: пересекается с соседним предметом #${j}`);
      });
    });

    // Укрытия — ровно на месте деревьев.
    coverSeen += layout.cover.length;
    check(layout.cover.length === s.trees.length, `${tag}: укрытий столько же, сколько деревьев`);
    layout.cover.forEach((c, i) => {
      check(c.x === s.trees[i].x && c.z === s.trees[i].z, `${tag}: укрытие #${i} стоит на месте дерева`);
      check([0, 1, 2, 3].includes(c.quarterTurns), `${tag}: укрытие повёрнуто кратно 90°`);
      kindsSeen.add(c.kind);
    });
  }
}
check(propsSeen > LAYOUT_SEEDS * 3, `реквизита слишком мало: ${propsSeen}`);
check(wallItemsSeen > LAYOUT_SEEDS * 5, `предметов у стен слишком мало: ${wallItemsSeen}`);
check(coverSeen > 0, "укрытий нет вообще");
for (const kind of ["machine", "plaque", "tank", "boiler", "tower"]) check(kindsSeen.has(kind), `за прогон ни разу не встретился предмет «${kind}»`);
check(propVariants.size === 4, `встретились не все виды реквизита: ${[...propVariants].join(",")}`);

// ---------- 3. Габариты моделей ----------

const engine = new NullEngine();
{
  const scene = new Scene(engine);
  const kit = steampunkKit(scene);
  const WALL_H = getBiome("steampunk").wallHeight;
  const EPS = 0.05;
  const bounds = (m: Mesh): { min: Vector3; max: Vector3 } => {
    m.computeWorldMatrix(true);
    const bb = m.getBoundingInfo().boundingBox;
    return { min: bb.minimum.clone(), max: bb.maximum.clone() };
  };

  kit.props.forEach((m, i) => {
    const b = bounds(m);
    check(b.min.y >= -EPS, `реквизит ${i}: уходит под пол (${b.min.y.toFixed(2)})`);
    check(b.max.y <= PROP.h + 0.15, `реквизит ${i}: выше габарита (${b.max.y.toFixed(2)})`);
    check(b.max.x - b.min.x <= PROP.w + 0.1 && Math.max(Math.abs(b.min.x), b.max.x) <= PROP.w / 2 + 0.1, `реквизит ${i}: шире габарита по X`);
    check(Math.max(Math.abs(b.min.z), b.max.z) <= PROP.d / 2 + 0.2, `реквизит ${i}: шире габарита по Z`);
  });

  kit.machines.forEach((m, i) => {
    const b = bounds(m);
    check(b.min.y >= -EPS && b.max.y <= WALL_H - 0.3, `машина ${i}: выходит за пол или упирается в верх стены (${b.min.y.toFixed(2)}…${b.max.y.toFixed(2)})`);
    check(Math.max(Math.abs(b.min.x), b.max.x) <= MACHINE.len / 2 + EPS, `машина ${i}: шире габарита вдоль стены`);
    check(b.min.z >= -MACHINE.depth / 2 - EPS, `машина ${i}: задняя сторона уходит в стену (${b.min.z.toFixed(2)})`);
    check(b.max.z <= MACHINE.depth / 2 + 0.15, `машина ${i}: выступает в проход (${b.max.z.toFixed(2)})`);
  });

  // Всё, что висит на стене: тонкое по Z, не ниже полуметра от пола и не выше стены.
  const hung: [string, Mesh, number][] = [
    ["табличка", kit.plaque, PLAQUE.thickness],
    ["иллюминатор", kit.porthole, PORTHOLE.thickness],
    ["трубы", kit.pipes, PIPES.thickness],
    ["шестерни", kit.wallGear, WALL_GEAR.thickness],
  ];
  for (const [label, m, th] of hung) {
    const b = bounds(m);
    check(b.min.z >= -th / 2 - 0.05, `${label}: задняя сторона уходит в стену (${b.min.z.toFixed(2)})`);
    check(b.max.z <= th / 2 + 0.25, `${label}: слишком выпирает из стены (${b.max.z.toFixed(2)})`);
    check(b.min.y >= 0.5, `${label}: висит слишком низко (${b.min.y.toFixed(2)})`);
    check(b.max.y <= WALL_H - 0.02, `${label}: выше стены (${b.max.y.toFixed(2)} > ${WALL_H})`);
    check(Math.max(Math.abs(b.min.x), b.max.x) <= 1.5, `${label}: шире секции стены (${b.max.x.toFixed(2)})`);
  }

  {
    const b = bounds(kit.tank);
    check(b.min.y >= -EPS && b.max.y <= TANK.h + EPS, `бак: вне габарита по высоте (${b.max.y.toFixed(2)})`);
    check(b.min.z >= -TANK.depth / 2 - EPS && b.max.z <= TANK.depth / 2 + 0.1, `бак: вне габарита по глубине`);
    check(Math.max(Math.abs(b.min.x), b.max.x) <= TANK.len / 2 + EPS, `бак: шире габарита`);
  }
  {
    const b = bounds(kit.boiler);
    check(b.min.y >= -EPS && b.max.y <= BOILER.h + 0.1 && b.max.y >= BOILER.h - 0.2, `котёл: высота ${b.max.y.toFixed(2)} не сходится с BOILER.h=${BOILER.h}`);
    check(Math.max(Math.abs(b.min.x), b.max.x, Math.abs(b.min.z), b.max.z) <= 0.8, `котёл: шире коллайдера`);
  }
  {
    const b = bounds(kit.tower);
    check(b.min.y >= -EPS && b.max.y <= TOWER.h + 0.5, `башня: вне габарита по высоте (${b.max.y.toFixed(2)})`);
    check(Math.max(Math.abs(b.min.x), b.max.x) <= TOWER.len / 2 + 0.1, `башня: шире коллайдера (${b.max.x.toFixed(2)})`);
    check(Math.max(Math.abs(b.min.z), b.max.z) <= TOWER.depth / 2 + 0.1, `башня: глубже коллайдера`);
  }
  {
    // Облако пара: внутри сферы-габарита куста (радиус 1.2), пол — на y = −радиус.
    const b = bounds(kit.steam);
    const corners = [b.min, b.max];
    check(b.min.y >= -BUSH_ENVELOPE_RADIUS - EPS, `облако: столб уходит под пол (${b.min.y.toFixed(2)})`);
    check(corners.every((c) => Math.hypot(c.x, c.z) <= BUSH_ENVELOPE_RADIUS * 1.25), `облако: шире сферы куста`);
    check(b.max.y <= BUSH_ENVELOPE_RADIUS + 0.1, `облако: выше сферы куста (${b.max.y.toFixed(2)})`);
    const v = bounds(kit.vent);
    check(v.min.y >= -EPS && v.max.y <= 0.2 && v.max.x <= 0.65, `решётка: плоская и в пределах метра`);
  }
  scene.dispose();
}

// ---------- 4. Сборка на Babylon (NullEngine) ----------

const BUILD_SEEDS = scaled(3, 12);
let chunksBuilt = 0;
let solidsBlocked = 0;
let texturedFloors = 0;
const FURNITURE = /^(prop_|machine_|plaque_|tank_|boiler_|tower_|vent_|steampunkCol_|treeCol_|bush_)/;

for (let seed = 1; seed <= BUILD_SEEDS; seed++) {
  const gs = new GameState();
  const world = generateWorld(gs, seed);
  const target = world.sections.find((s) => s.tier > 0 && !s.forkBranch && s.width >= 20 && s.length >= 36);
  if (!target) continue;
  applyBiome(target, "steampunk");
  const tag = `seed ${seed} #${target.index}`;
  const layout = layoutSteampunk(target);

  const scene = new Scene(engine);
  const baseline = scene.meshes.length;
  const index = new FootprintIndex([target]);
  const chunk = new SectionChunk(scene, target, index);
  chunk.build(gs);
  chunksBuilt++;
  for (const m of scene.meshes) m.computeWorldMatrix(true);

  // Укрытия на месте: кусты → клубы пара, деревья → котлы и башни.
  check(chunk.bushVolumes.length === target.bushes.length, `${tag}: облаков-укрытий ${chunk.bushVolumes.length} ≠ кустов ${target.bushes.length}`);
  check(chunk.treeVolumes.length === target.trees.length, `${tag}: котлов-укрытий ${chunk.treeVolumes.length} ≠ деревьев ${target.trees.length}`);
  for (const t of chunk.treeVolumes) {
    check(t.canopy instanceof Mesh && t.canopy.isEnabled() && t.blockRadius > 0.3, `${tag}: котёл/башня — настоящий меш с радиусом обзора`);
    t.canopy.visibility = 0.3;
    check(t.canopy.visibility === 0.3, `${tag}: котёл/башня прозрачнеет независимо от других`);
    t.canopy.visibility = 1;
  }
  for (const b of chunk.bushVolumes) {
    b.setAlpha(0.4);
    check(b.mesh.visibility === 0.4 && b.blockRadius > 0.3 && b.blockRadius <= b.radius + 1e-6, `${tag}: облако-укрытие работает как куст`);
    check(Math.abs(b.radius - BUSH_ENVELOPE_RADIUS * (b.mesh.scaling.x)) < 1e-6, `${tag}: радиус облака = радиус куста × масштаб`);
    b.setAlpha(1);
  }

  // Контракт укрытий — как в поле: «кусты» называются bush_*, у каждого котла есть свой невидимый treeCol_* в его позиции.
  check(chunk.bushVolumes.every((b) => b.mesh.name.startsWith("bush_") && scene.getMeshByName(b.mesh.name) === b.mesh), `${tag}: облака-укрытия — меши bush_*`);
  check(
    chunk.treeVolumes.every((t) => scene.meshes.some((m) => m.name.startsWith("treeCol_") && Math.hypot(m.position.x - t.x, m.position.z - t.z) < 1e-6 && m.checkCollisions && !m.isVisible)),
    `${tag}: у каждого котла/башни есть невидимый коллайдер treeCol_*`
  );

  // Один слитый коллайдер, предметы отдельными мешами, шаблоны выключены.
  const colliders = scene.meshes.filter((m) => m.name.startsWith("steampunkCol_"));
  check(colliders.length === 1 && colliders[0].checkCollisions && !colliders[0].isVisible, `${tag}: один невидимый коллайдер предметов на секцию`);
  check(scene.meshes.some((m) => m.name.startsWith("prop_")) === layout.props.length > 0, `${tag}: реквизит построен`);
  check(scene.meshes.some((m) => m.name.startsWith("machine_")) === layout.wall.some((w) => w.kind === "machine"), `${tag}: машины построены`);
  const kit = steampunkKit(scene);
  check([...kit.props, ...kit.machines, kit.plaque, kit.porthole, kit.pipes, kit.wallGear, kit.tank, kit.boiler, kit.tower, kit.vent, kit.steam].every((m) => !m.isEnabled()), `${tag}: шаблоны выключены`);
  check(!scene.meshes.some((m) => m.name.startsWith("grass_")), `${tag}: в цехе трава не растёт`);
  check(!scene.meshes.some((m) => m.name.startsWith("desk_") || m.name.startsWith("classroomCol_")), `${tag}: в цехе нет мебели класса`);

  // Пол: клёпаная сталь (если есть canvas) или однотонный — но пол в любом случае есть и держит.
  const floors = scene.meshes.filter((m) => m.name.startsWith("floor_"));
  check(floors.length > 0, `${tag}: есть пол`);
  if (steampunkFloorTexture(scene)) {
    texturedFloors++;
    check(floors.every((f) => !!(f.material as { diffuseTexture?: unknown } | null)?.diffuseTexture), `${tag}: полы выложены стальными плитами`);
  }

  // Твёрдость: игрок упирается в реквизит, а без коллайдера проходит насквозь (контроль теста).
  for (const m of scene.meshes) {
    const isGeometry = m.name.startsWith("floor_") || m.name.startsWith("walls_") || m.name.startsWith("wallBox_") || m.name.startsWith("steampunkCol_");
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
    return (player.position.x - cx) * dirX + (player.position.z - cz) * dirZ; // >0 — прошёл дальше центра предмета
  };
  const probe = layout.props.slice(0, 3);
  for (const p of probe) {
    const w = localToWorld(target, p.x, p.z);
    const yaw = yawAt(target, p.z) + p.yawJitter; // направление вдоль длинной стороны реквизита
    const dirX = Math.cos(yaw);
    const dirZ = -Math.sin(yaw);
    const blocked = walkAcross(w.x, w.z, dirX, dirZ);
    colliders[0].checkCollisions = false;
    const free = walkAcross(w.x, w.z, dirX, dirZ);
    colliders[0].checkCollisions = true;
    check(free > 0.5, `${tag}: контроль — без коллайдера игрок проходит реквизит насквозь (${free.toFixed(2)})`);
    check(blocked < 0, `${tag}: реквизит (${p.x.toFixed(1)},${p.z.toFixed(1)}) не держит игрока (${blocked.toFixed(2)})`);
    if (blocked < 0) solidsBlocked++;
  }

  // Освобождение: предметов не остаётся, шаблоны и текстуры на сцену — остаются.
  chunk.dispose();
  const leftovers = scene.meshes.filter((m) => FURNITURE.test(m.name));
  check(leftovers.length === 0, `${tag}: после dispose остались предметы: ${leftovers.map((m) => m.name).slice(0, 5).join(", ")}`);
  check(scene.getMeshByName("steampunk_prop_0") !== null, `${tag}: шаблоны живут вместе со сценой`);
  check(scene.meshes.length >= baseline, `${tag}: счётчик мешей не уходит ниже исходного`);
  scene.dispose();
}
check(chunksBuilt > 0, "ни одного цеха не собрано на Babylon");

// Поле и класс собираются по-прежнему и без предметов цеха.
for (const biome of ["meadow", "classroom"] as const) {
  const gs = new GameState();
  const world = generateWorld(gs, 3);
  const spec = world.sections.find((s) => s.tier > 0 && s.biome === biome) ?? world.sections.find((s) => s.tier > 0)!;
  applyBiome(spec, biome);
  const scene = new Scene(engine);
  const chunk = new SectionChunk(scene, spec, new FootprintIndex([spec]));
  chunk.build(gs);
  check(!scene.meshes.some((m) => /^(prop_|machine_|plaque_|tank_|boiler_|tower_|vent_|steampunkCol_)/.test(m.name) || m.name.startsWith("steampunk_")), `${biome}: никаких предметов цеха`);
  check(!scene.meshes.some((m) => m.name.startsWith("steampunk_")), `${biome}: шаблоны цеха не строятся без нужды`);
  chunk.dispose();
  scene.dispose();
}

console.log = realLog;
console.log(`цехов в мирах: ${steamSections}/${sectionsTotal} секций (${worldsWithSteam}/${GEN_SEEDS} миров), реквизита ${propsSeen}, предметов у стен ${wallItemsSeen}, укрытий ${coverSeen}; собрано чанков ${chunksBuilt}, стальных полов ${texturedFloors}, предметов проверено на твёрдость ${solidsBlocked}`);
if (failures > 0) {
  console.error(`\n${failures} из ${checks} проверок не прошли`);
  process.exit(1);
}
console.log(`OK: стимпанк — ${checks} проверок (назначение, раскладка, габариты моделей, сборка, коллизии)`);
