import { NullEngine, Scene } from "@babylonjs/core";
import { generateWorld, localToWorld, distPointToSegment } from "../src/world/WorldGenerator";
import type { SectionSpec, WorldSpec } from "../src/world/WorldGenerator";
import { WorldStreamer } from "../src/world/WorldStreamer";
import { FogManager } from "../src/world/FogManager";
import { GameState } from "../src/core/GameState";

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

const engine = new NullEngine();
const scene = new Scene(engine);
const gameState = new GameState();

// Бёрём мир, в котором есть развилка (обычно хватает пары сидов).
let world = generateWorld(gameState, 42);
let forkParent = world.sections.find((s) => s.gates.length === 2) ?? null;
for (let seed = 43; seed <= 100 && !forkParent; seed++) {
  world = generateWorld(gameState, seed);
  forkParent = world.sections.find((s) => s.gates.length === 2) ?? null;
}
check(!!forkParent, "не удалось найти сид с развилкой");

const streamer = new WorldStreamer(scene, world, gameState);
const fog = new FogManager(scene, world);

// --- старт: построены секции 0 и 1 ---
streamer.update(world.spawnPoint.x, world.spawnPoint.z);
check(streamer.isBuilt(0), "первая секция не построена на старте");
check(streamer.isBuilt(1), "вторая секция не построена на старте");
check(streamer.getActiveBonfires().length > 0, "на старте нет костров");
check(streamer.getActiveWitches().length > 0, "на старте нет ведьм");
const frontierAtStart = streamer.frontierIndex();
check(frontierAtStart >= 1, "frontier на старте должен быть за второй секцией");
fog.update(frontierAtStart, 5);
check(fog.isWallActive(frontierAtStart), "туман должен стоять на frontier");

// Ведьма из первой боевой секции (рядом со спавном) — на неё проверим персистентность.
const savedWitchId = streamer.getActiveWitches()[0]?.id ?? null;
if (savedWitchId) gameState.markWitchDefeated(savedWitchId);

// --- вилка: у развилки видны ОБА параллельных коридора ---
const parent = forkParent!;
const branchA = world.sections.find((s) => s.forkBranch === "a")!;
const branchB = world.sections.find((s) => s.forkBranch === "b")!;
const join = world.sections.find((s) => s.index === branchA.index + 1 && !s.forkBranch)!;
check(!!branchA && !!branchB && !!join, "не найдены ветки/схождение развилки");

const pc = localToWorld(parent, 0, parent.length / 2);
streamer.update(pc.x, pc.z);
check(streamer.isBuilt(parent.index), "у развилки родитель не построен");
check(streamer.isChunkBuilt(branchA) && streamer.isChunkBuilt(branchB), "у развилки должны быть видны обе ветки");
check(!streamer.isBuilt(join.index), "схождение J не должно строиться, пока игрок у ворот");

// --- выбор ветки A: невыбранная B остаётся видна (зона развилки) ---
gameState.openGate(branchA.forkGateId!);
const ac = localToWorld(branchA, 0, branchA.length / 2);
streamer.update(ac.x, ac.z);
check(streamer.isChunkBuilt(branchA), "выбранная ветка не построена");
check(streamer.isChunkBuilt(branchB), "невыбранная ветка B выгружена в зоне развилки");
check(streamer.isChunkBuilt(join), "схождение J не построено после входа в ветку");

// --- обо всей длины ветки B нет, A есть ---
const acEnd = localToWorld(branchA, 0, branchA.length - 1);
streamer.update(acEnd.x, acEnd.z);
check(streamer.isChunkBuilt(branchA), "ветка A пропала на её протяжении");
check(streamer.isChunkBuilt(branchB), "ветка B пропала на протяжении A (зона развилки)");

// --- дальше по стволу после J ---
const jc = localToWorld(join, 0, join.length - 1);
streamer.update(jc.x, jc.z);
check(streamer.isChunkBuilt(join), "схождение J не построено");
check(
  streamer.isChunkBuilt(branchB),
  "невыбранная ветка B пропала в схождении J (она должна быть видна у выхода из развилки)"
);

// --- максимум одновременных сущностей в окне ±1 ---
let maxEntities = 0;
for (const s of world.sections) {
  if (s.tier === 0 || s.forkBranch) continue; // подход и ветки пропускаем — они за окном теста
  const c = localToWorld(s, 0, Math.min(s.length / 2, s.length - 2));
  streamer.update(c.x, c.z);
  const count = streamer.getActiveWitches().length + streamer.getActiveBonfires().length + streamer.getActivePracticeTargets().length;
  maxEntities = Math.max(maxEntities, count);
}
check(maxEntities < 60, `многовато сущностей одновременно в окне: ${maxEntities}`);
console.log(`максимум одновременно видно: ${maxEntities} сущностей`);

// --- персистентность побеждённых ведьм (ведьма из секции рядом со спавном) ---
if (savedWitchId) {
  const last = world.sections[world.sections.length - 1];
  const far = localToWorld(last, 0, last.length - 2);
  streamer.update(far.x, far.z);
  streamer.update(world.spawnPoint.x, world.spawnPoint.z);
  const revived = streamer.getActiveWitches().find((w) => w.id === savedWitchId);
  check(!!revived && revived.friendly, "побеждённая ведьма не вернулась дружелюбной");
}

// --- туман следует за frontier ---
streamer.update(world.spawnPoint.x, world.spawnPoint.z);
fog.update(streamer.frontierIndex(), 5);
check(fog.isWallActive(streamer.frontierIndex()), "туман не встал на новый frontier");

// ---------------------------------------------------------------------------
// Баг «мир перегенерируется возле игрока» (регрессия): sectionAt() возвращал
// ПОЗИЦИЮ чанка в массиве, а окно стриминга (±1), видимость веток и туман
// считаются по spec.index (генераторному индексу). После первой развилки
// нумерации расходятся (ветки A/B делят индекс N+1, схождение — N+2, массив
// растёт на 4 позиции), и на развилке №2+ секция ПОД ИГРОКОМ попадала вне
// окна: геометрия появлялась заранее и исчезала в момент входа.
//
// Прогулка вперёд по всему миру (на каждой развилке выбираем ветку A) обязана
// сохранять инварианты:
//   1) секция под игроком всегда построена;
//   2) ни один чанк не пересобирается после выгрузки (нет churn);
//   3) frontier (край тумана) монотонно растёт, не откатывается;
//   4) у закрытых ворот развилки видны ОБЕ ветки, схождение не построено;
//      невыбранная ветка остаётся видна, пока игрок в «зоне развилки»
//      (родитель..схождение J), и выгружается после ухода за J.
// ---------------------------------------------------------------------------

function nearestSpecAt(world: WorldSpec, x: number, z: number): SectionSpec {
  let best = world.sections[0];
  let bestD = Infinity;
  for (const s of world.sections) {
    const d = distPointToSegment(x, z, s.start.x, s.start.z, s.end.x, s.end.z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/**
 * Оси родителя и его схождения J коллинеарны (jStart = cursor + dir*branchLen
 * лежит на оси родителя), поэтому в зоне перекрытия у точки есть НЕСКОЛЬКО
 * секций с одинаковым расстоянием до оси. «Секция под игроком» здесь — любой
 * из паритетных кандидатов: достаточно, чтобы был построен хотя бы один из них.
 */
function someSectionBuiltAt(world: WorldSpec, streamer: WorldStreamer, x: number, z: number): boolean {
  let minD = Infinity;
  const dists = world.sections.map((s) => distPointToSegment(x, z, s.start.x, s.start.z, s.end.x, s.end.z));
  for (const d of dists) minD = Math.min(minD, d);
  return world.sections.some((s, i) => dists[i] - minD <= 0.5 && streamer.isChunkBuilt(s));
}

// Прогулка вперёд по всему миру (на каждой развилке выбираем ветку A).
// Возвращает счётчики нарушений инвариантов:
//   missing — под игроком не построено НИ ОДНОЙ секции из паритетного набора;
//   drops   — frontier откатился;
//   maxBuilds — сколько раз пересобирался худший чанк (монотонная прогулка должна
//   строить каждый чанк ровно один раз).
function walkForward(seed: number): { missing: number; drops: number; maxBuilds: number } {
  const gs = new GameState();
  const w = generateWorld(gs, seed);
  const st = new WorldStreamer(scene, w, gs);

  const branchOf = (parent: SectionSpec, which: "a" | "b"): SectionSpec | undefined =>
    w.sections.find((s) => s.forkBranch === which && s.forkParentIndex === parent.index);
  const joinOf = (parent: SectionSpec): SectionSpec | undefined =>
    w.sections.find((s) => !s.forkBranch && s.index === parent.index + 2);

  let missing = 0;
  let drops = 0;
  const builds = new Map<SectionSpec, { wasBuilt: boolean; builds: number }>();
  let prevFrontier = st.frontierIndex();

  for (const spec of w.sections) {
    if (spec.forkBranch === "b") continue; // идём только по ветке A

    const isFork = spec.gates.length === 2;
    const forkA = isFork ? branchOf(spec, "a")! : null;
    const forkB = isFork ? branchOf(spec, "b")! : null;
    const join = isFork ? joinOf(spec)! : null;

    const steps = Math.max(4, Math.floor(spec.length / 4));
    for (let k = 1; k <= steps; k++) {
      const p = localToWorld(spec, 0, (spec.length * k) / steps);
      st.update(p.x, p.z);

      // 1) под игроком всегда есть построенная секция (с учётом паритета осей)
      if (!someSectionBuiltAt(w, st, p.x, p.z)) {
        const nearest = nearestSpecAt(w, p.x, p.z);
        missing++;
        console.error(`seed ${seed}: под игроком ничего не построено (ближайшая [${nearest.index}], точка ${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
      }

      // 2) монотонная прогулка: чанк строится максимум один раз
      for (const s2 of w.sections) {
        const rec = builds.get(s2) ?? { wasBuilt: false, builds: 0 };
        const built = st.isChunkBuilt(s2);
        if (built && !rec.wasBuilt) rec.builds++;
        rec.wasBuilt = built;
        builds.set(s2, rec);
      }

      // 3) frontier монотонен
      const f = st.frontierIndex();
      if (f < prevFrontier) {
        drops++;
        console.error(`seed ${seed}: frontier откатился ${prevFrontier} -> ${f} (точка ${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
      }
      prevFrontier = f;

      // 4) у закрытых ворот развилки видны обе ветки, схождение — нет;
      //    затем игрок выбирает ветку A
      if (isFork && k === 1) {
        check(
          st.isChunkBuilt(forkA!) && st.isChunkBuilt(forkB!),
          `seed ${seed}: у закрытых ворот развилки ${spec.index} видны не обе ветки`
        );
        check(!st.isChunkBuilt(join!), `seed ${seed}: схождение ${join!.index} построено, пока игрок у закрытых ворот`);
        gs.openGate(spec.gates[0].id);
      }

      // 5) после входа в ветку A невыбранная B всё ещё видна (зона развилки),
      //    J построено; B выгрузится только после ухода за J
      if (spec.forkBranch === "a" && k === 1) {
        const parent = w.sections.find((s) => s.index === spec.forkParentIndex)!;
        check(st.isChunkBuilt(branchOf(parent, "b")!), `seed ${seed}: невыбранная ветка B пропала после входа в A (зона развилки)`);
        check(st.isChunkBuilt(joinOf(parent)!), `seed ${seed}: схождение не построено после входа в A`);
      }
    }
  }

  const maxBuilds = Math.max(0, ...[...builds.values()].map((r) => r.builds));
  return { missing, drops, maxBuilds };
}

// Нужны миры минимум с ДВУМЯ развилками: именно со второй позиция в массиве
// разъезжается с spec.index, а оси схождений коллинеарны осям родителей —
// оба бага ловятся только там.
const walkSeeds: number[] = [];
for (let seed = 1; seed <= 400 && walkSeeds.length < 20; seed++) {
  const w = generateWorld(new GameState(), seed);
  const forks = w.sections.filter((s) => s.gates.length === 2).length;
  if (forks >= 2) walkSeeds.push(seed);
}
check(walkSeeds.length >= 5, `найдено слишком мало миров с двумя развилками: ${walkSeeds.length}`);

for (const seed of walkSeeds) {
  const { missing, drops, maxBuilds } = walkForward(seed);
  check(missing === 0, `seed ${seed}: секция под игроком выгружалась ${missing} раз`);
  check(drops === 0, `seed ${seed}: frontier откатывался ${drops} раз`);
  check(maxBuilds <= 1, `seed ${seed}: чанк пересобирался ${maxBuilds} раза — churn при монотонной прогулке`);
}
console.log(`прогулок вперёд: ${walkSeeds.length} миров с >=2 развилками (сиды ${walkSeeds.join(", ")})`);

// ---------------------------------------------------------------------------
// Регрессия «мигание секции у закрытых ворот развилки» (отчёт игрока: стоял
// перед воротами, покачивался вперёд-назад — следующая секция перестраивалась
// каждый кадр). Причина: ось ветки развилки начинается у САМИХ ворот родителя,
// поэтому по чистой близости sectionAt сажал игрока в ветку ДО прохода ворот
// (ветка ближе, чем ось родителя), а update() с закрытыми воротами выгружал
// обе ветки и строил схождение J. Покачивание туда-сюда = build/dispose цикл.
//
// Ожидание (после фикса): закрытая ветка НЕ участвует в выборе секции игрока —
// section всё время родитель, после первичной сборки НИ ОДИН чанк не меняет
// состояние, обе ветки видны, схождение не построено.
function forkGateHoverRegression(seed: number): void {
  const gs = new GameState();
  const w = generateWorld(gs, seed);
  const st = new WorldStreamer(scene, w, gs);

  const parent = w.sections.find((s) => s.gates.length === 2)!;
  const branchA = w.sections.find((s) => s.forkBranch === "a" && s.forkParentIndex === parent.index)!;
  const branchB = w.sections.find((s) => s.forkBranch === "b" && s.forkParentIndex === parent.index)!;
  const join = w.sections.find((s) => !s.forkBranch && s.index === parent.index + 2)!;

  // «mouth» — на линии ворот у входа в ветку A (старый sectionAt считал здесь
  // секцией ветку: дистанция до старта оси ветки < дистанции до конца родителя);
  // «away» — на 6 м вглубь родителя от конца (честно родитель). Качаемся между ними.
  const E = { x: parent.end.x, z: parent.end.z };
  const mouth = { x: branchA.start.x, z: branchA.start.z };
  const away = { x: E.x + (E.x - mouth.x), z: E.z + (E.z - mouth.z) };

  st.update(away.x, away.z); // первичная сборка окна родителя
  const state = new Map<SectionSpec, boolean>();
  for (const s of w.sections) state.set(s, st.isChunkBuilt(s));

  let transitions = 0;
  for (let i = 0; i < 60; i++) {
    const p = i % 2 === 0 ? mouth : away;
    st.update(p.x, p.z);
    const cur = st.sectionAt(p.x, p.z);
    check(cur === parent.index, `seed ${seed}: у закрытых ворот section прыгнул на ${cur} вместо родителя ${parent.index}`);
    for (const s of w.sections) {
      const built = st.isChunkBuilt(s);
      if (built !== state.get(s)) {
        transitions++;
        state.set(s, built);
      }
    }
  }
  check(transitions === 0, `seed ${seed}: покачивание у закрытых ворот перестроило чанки ${transitions} раз`);
  check(
    st.isChunkBuilt(branchA) && st.isChunkBuilt(branchB),
    `seed ${seed}: у закрытых ворот выгрузилась ветка развилки`
  );
  check(!st.isChunkBuilt(join), `seed ${seed}: схождение J построено у закрытых ворот`);
}

// ---------------------------------------------------------------------------
// Гистерезис переключения секции: мёртвая зона у стыка осей (секции сходятся
// в одной точке). Игрок, зашедший в следующую секцию меньше чем на порог,
// остаётся на текущей; реальный уход переключает, и обратно — только после
// такого же реального отхода (Schmitt trigger, без дребезга).
function hysteresisBandRegression(seed: number): void {
  const gs = new GameState();
  const w = generateWorld(gs, seed);
  const st = new WorldStreamer(scene, w, gs);

  const s0 = w.sections.find((s) => s.index === 0)!;
  const s1 = w.sections.find((s) => s.index === 1)!;
  const dirX = Math.sin(s1.yaw);
  const dirZ = Math.cos(s1.yaw);
  const at = (d: number): { x: number; z: number } => ({
    x: s0.end.x + dirX * d,
    z: s0.end.z + dirZ * d,
  });

  check(st.sectionAt(at(-4).x, at(-4).z) === 0, `seed ${seed}: старт не в секции 0`);
  check(st.sectionAt(at(0.5).x, at(0.5).z) === 0, `seed ${seed}: переключение на 1 раньше гистерезиса (+0.5 м)`);
  check(st.sectionAt(at(3).x, at(3).z) === 1, `seed ${seed}: нет переключения на 1 при явном уходе (+3 м)`);
  check(st.sectionAt(at(1).x, at(1).z) === 1, `seed ${seed}: откат на 0 в мёртвой зоне (+1 м назад)`);
  check(st.sectionAt(at(-4).x, at(-4).z) === 0, `seed ${seed}: нет возврата в 0 после реального отхода (-4 м)`);
}

// ---------------------------------------------------------------------------
// Регрессия «дребезг после открытия одних ворот, до входа»: игрок открыл
// ветку A, но НЕ вошёл — ходит вдоль стыка между открытой A и закрытой B.
// Ось открытой ветки начинается у самых ворот: при старом коде (кандидат =
// открытая ветка) у входа в A дистанция до оси ~0, у входа в B — секция
// родитель, и ходьба туда-сюда перестраивала окно каждый кадр. Ожидание:
// ветка становится секцией только после РЕАЛЬНОГО входа (проекция на её ось
// > FORK_ENTRY_M), поэтому у стыка section всё время родитель и переходов нет.
function forkGateHoverOpenRegression(seed: number): void {
  const gs = new GameState();
  const w = generateWorld(gs, seed);
  const st = new WorldStreamer(scene, w, gs);

  const parent = w.sections.find((s) => s.gates.length === 2)!;
  const branchA = w.sections.find((s) => s.forkBranch === "a" && s.forkParentIndex === parent.index)!;
  const branchB = w.sections.find((s) => s.forkBranch === "b" && s.forkParentIndex === parent.index)!;
  const join = w.sections.find((s) => !s.forkBranch && s.index === parent.index + 2)!;

  gs.openGate(branchA.forkGateId ?? "");
  // «Стык ворот»: ось ветки A начинается в точке старта A; старт B — на той же
  // линии ворот в 12 м в стороне. Качаемся между ними — оба входа не пройдены.
  st.update(branchB.start.x, branchB.start.z); // первичная сборка окна родителя
  const state = new Map<SectionSpec, boolean>();
  for (const s of w.sections) state.set(s, st.isChunkBuilt(s));

  let transitions = 0;
  for (let i = 0; i < 60; i++) {
    const p = i % 2 === 0 ? branchB.start : branchA.start;
    st.update(p.x, p.z);
    const cur = st.sectionAt(p.x, p.z);
    check(cur === parent.index, `seed ${seed}: у открытой ветки (до входа) section прыгнул на ${cur} вместо родителя ${parent.index}`);
    for (const s of w.sections) {
      const built = st.isChunkBuilt(s);
      if (built !== state.get(s)) {
        transitions++;
        state.set(s, built);
      }
    }
  }
  check(transitions === 0, `seed ${seed}: ходьба вдоль ворот (открытая+закрытая) перестроила чанки ${transitions} раз`);
  check(
    st.isChunkBuilt(branchA) && st.isChunkBuilt(branchB),
    `seed ${seed}: у стыка ворот выгрузилась ветка развилки`
  );
  check(!st.isChunkBuilt(join), `seed ${seed}: схождение J построено у не зашедшего в ветку игрока`);
}

// ---------------------------------------------------------------------------
// Регрессия «дребезг тумана при выходе из развилки и назад»: игрок прошёл
// выбранную ветку A, качается на границе конец-ветки (section = ветка) и
// схождение J (section = J). При старом коде окно [parent..J] ↔ [A..next]
// перестраивало parent и следующую секцию, а туман (frontier = max построенный
// индекс) откатывался вперёд-назад. Плюс «второй путь» (невыбранная B) не
// строилась при current = J — у выхода из развилки пустота и туман вплотную.
//
// Ожидание: мягкая выгрузка (DISPOSE_MARGIN) держит parent/next при качании,
// ветки видны всю «зону развилки» (parent..J) — после первичной сборки НИ
// ОДИН чанк не меняет состояние, frontier не откатывается, туман не прыгает.
function forkExitRegression(seed: number): void {
  const gs = new GameState();
  const w = generateWorld(gs, seed);
  const st = new WorldStreamer(scene, w, gs);

  const parent = w.sections.find((s) => s.gates.length === 2)!;
  const branchA = w.sections.find((s) => s.forkBranch === "a" && s.forkParentIndex === parent.index)!;
  const branchB = w.sections.find((s) => s.forkBranch === "b" && s.forkParentIndex === parent.index)!;
  const join = w.sections.find((s) => !s.forkBranch && s.index === parent.index + 2)!;
  const after = w.sections.find((s) => s.index === join.index + 1);

  gs.openGate(branchA.forkGateId ?? "");

  // Точка на конце ветки A (section = ветка) и точка в схождении J через
  // ~6 м от его старта (section = J): «вышел из развилки и вернулся».
  const endA = { x: branchA.end.x, z: branchA.end.z };
  const jx = Math.sin(join.yaw);
  const jz = Math.cos(join.yaw);
  const inJoin = { x: join.start.x + jx * 6, z: join.start.z + jz * 6 };

  st.update(inJoin.x, inJoin.z); // первичная сборка: current = J, строятся A/B/J/next
  st.update(endA.x, endA.z); // обратно в ветку: current = ветка, достраивается parent
  const state = new Map<SectionSpec, boolean>();
  for (const s of w.sections) state.set(s, st.isChunkBuilt(s));
  const frontierAtRest = st.frontierIndex();

  let transitions = 0;
  for (let i = 0; i < 60; i++) {
    const p = i % 2 === 0 ? endA : inJoin;
    st.update(p.x, p.z);
    for (const s of w.sections) {
      const built = st.isChunkBuilt(s);
      if (built !== state.get(s)) {
        transitions++;
        state.set(s, built);
      }
    }
    check(
      st.frontierIndex() >= frontierAtRest,
      `seed ${seed}: frontier откатился ниже ${frontierAtRest} при качании у выхода из развилки`
    );
  }
  check(transitions === 0, `seed ${seed}: качание на выходе из ветки в J перестроило чанки ${transitions} раз`);
  check(st.isChunkBuilt(branchB), `seed ${seed}: «второй путь» (ветка B) выгружен у выхода из развилки`);
  check(st.isChunkBuilt(join), `seed ${seed}: схождение J выгружено при качании на выходе из ветки`);

  // Ушёл за J — невыбранная ветка выгружается. Точка забирается ГЛУБЖЕ
  // δ мёртвой зоны гистерезиса (2 м от конца J), иначе current остаётся J.
  if (after) {
    const c = localToWorld(after, 0, Math.min(5, after.length - 2));
    st.update(c.x, c.z);
    check(!st.isChunkBuilt(branchB), `seed ${seed}: невыбранная ветка B видна после ухода за схождение`);
  }
}

const hoverSeeds = walkSeeds.slice(0, 6);
for (const seed of hoverSeeds) {
  forkGateHoverRegression(seed);
  forkGateHoverOpenRegression(seed);
  forkExitRegression(seed);
  hysteresisBandRegression(seed);
}
console.log(`покачиваний у ворот: ${hoverSeeds.length} миров (сиды ${hoverSeeds.join(", ")})`);

console.log(`Проверок: ${checks}, провалов: ${failures}`);
if (failures > 0) {
  console.error("FAILED: стриминг секций");
  process.exit(1);
}
console.log("OK: стриминг секций, вилки и туман на frontier работают корректно");