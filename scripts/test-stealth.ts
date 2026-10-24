/**
 * test-stealth.ts — стелс целиком (кроме браузера):
 *
 *  A. Генерация: ведьмы-охранники спавнятся у сундуков; кусты редкие, небольшие,
 *     разнесённые и не лежат на сущностях; рощи по 3–5 деревьев; заросли у края
 *     коридора досягаемы.
 *  B. StealthManager на NullEngine: игрок в кусте/зарослях → hidden, они плавно
 *     становятся полупрозрачными, игрок — тоже; кроны деревьев прозрачнеют между
 *     камерой и игроком; вышел → всё возвращается.
 *  C. Witch.updateAi на настоящих коллизиях: идёт к игроку, но стена и стволы её
 *     не пропускают; без прямой видимости (стена) игрока не замечает; чужая
 *     секция — территория, за которой ведьма только наблюдает.
 *  D. Обзор: кусты, заросли и деревья перекрывают линию взгляда (cover.ts + менеджер).
 *  E. ProximityDetector: спрятанного игрока бой не начинает; ведьма у сундука
 *     больше не «глохнет» (игрок у сундука не неуязвим).
 */
import { NullEngine, Scene, MeshBuilder, Vector3, Camera } from "@babylonjs/core";
import { generateWorld } from "../src/world/WorldGenerator";
import { WorldStreamer } from "../src/world/WorldStreamer";
import { GameState } from "../src/core/GameState";
import { Witch } from "../src/entities/Witch";
import { ALL_SPELLS } from "../src/data/spells";
import { StealthManager } from "../src/stealth/StealthManager";
import { BUSH_HIDE_FACTOR, findHidingBush, bushCoversPlayer } from "../src/stealth/bushes";
import { eyeLevelRadius, isSightBlocked, EYE_HEIGHT, MIN_BLOCK_CHORD } from "../src/stealth/cover";
import { SectionChunk } from "../src/world/SectionChunk";
import { FootprintIndex } from "../src/world/geometry/Footprint";
import { ProximityDetector } from "../src/world/proximity";
import { EncounterCooldown } from "../src/core/encounterCooldown";
import type { PlayerController } from "../src/core/PlayerController";

declare const process: { exit(code?: number): never; env: Record<string, string | undefined> };

let checks = 0;
let failures = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= 25) console.error("FAIL:", msg);
  }
}

const realLog = console.log;
console.log = () => {}; // глушим [stream]/[world-gen]

// ---------------------------------------------------------------------------
// A. Генерация
// ---------------------------------------------------------------------------
{
  const SEEDS = Number(process.env.SEEDS ?? 40);
  let sections = 0;
  let totalBushes = 0;
  let totalTrees = 0;
  let guardChecked = 0;
  let guardOk = 0;
  let spurChecked = 0;
  let thicketSeeds = 0;
  let thicketReachable = 0;

  for (let seed = 1; seed <= SEEDS; seed++) {
    const world = generateWorld(new GameState(), seed);
    for (const s of world.sections) {
      if (s.tier === 0) continue;
      sections++;
      totalBushes += s.bushes.length;
      totalTrees += s.trees.length;

      // Кусты: размер, количество, разнесённость, чистота от сущностей.
      check(s.bushes.length <= Math.max(2, Math.round(s.length * 0.1)), `seed ${seed} #${s.index}: кустов слишком много (${s.bushes.length})`);
      const entities = [...s.witches, ...s.chests, ...s.bonfires, ...s.practiceTargets];
      for (let i = 0; i < s.bushes.length; i++) {
        const b = s.bushes[i];
        check(b.scale >= 0.8 - 1e-9 && b.scale <= 1.05 + 1e-9, `seed ${seed} #${s.index}: scale куста ${b.scale.toFixed(2)} вне 0.8–1.05`);
        check(Math.abs(b.x) <= s.width / 2 - 1.4 + 1e-9 && b.z > 0 && b.z < s.length, `seed ${seed} #${s.index}: куст вне коридора`);
        for (const e of entities) {
          check(Math.hypot(b.x - e.x, b.z - e.z) >= 3 - 1e-9, `seed ${seed} #${s.index}: куст ближе 3 м к сущности ${e.id}`);
        }
        for (let j = i + 1; j < s.bushes.length; j++) {
          check(Math.hypot(b.x - s.bushes[j].x, b.z - s.bushes[j].z) >= 6 - 1e-9, `seed ${seed} #${s.index}: два куста ближе 6 м`);
        }
      }

      // Рощи: деревья в проходимой ширине, не на сущностях и кустах, стволы не сливаются.
      check(s.trees.length === 0 || s.trees.length >= 3, `seed ${seed} #${s.index}: одинокое дерево (${s.trees.length}) — роща должна быть из 3–5`);
      check(s.trees.length <= Math.max(1, Math.round(s.length * 0.04)) * 5, `seed ${seed} #${s.index}: слишком много деревьев (${s.trees.length})`);
      for (let i = 0; i < s.trees.length; i++) {
        const t = s.trees[i];
        check(t.scale >= 0.85 - 1e-9 && t.scale <= 1.2 + 1e-9, `seed ${seed} #${s.index}: scale дерева ${t.scale.toFixed(2)} вне 0.85–1.2`);
        check(Math.abs(t.x) <= s.width / 2 - 2.2 + 1e-9 && t.z >= 1 - 1e-9 && t.z <= s.length - 1 + 1e-9, `seed ${seed} #${s.index}: дерево вне коридора`);
        for (const e of entities) {
          check(Math.hypot(t.x - e.x, t.z - e.z) >= 1.8, `seed ${seed} #${s.index}: дерево прямо на сущности ${e.id}`);
        }
        for (const b of s.bushes) {
          check(Math.hypot(t.x - b.x, t.z - b.z) >= 1.8, `seed ${seed} #${s.index}: дерево прямо на кусте`);
        }
        for (let j = i + 1; j < s.trees.length; j++) {
          check(Math.hypot(t.x - s.trees[j].x, t.z - s.trees[j].z) >= 1.7 - 1e-9, `seed ${seed} #${s.index}: стволы деревьев слились`);
        }
      }

      // Заросли у края коридора (стиль «bushes»): в центр зоны укрытия можно дойти (стена — на ±width/2).
      if (s.borderStyle === "bushes") {
        for (const side of [s.borderLeft, s.borderRight]) {
          for (const b of side) {
            thicketSeeds++;
            const r = 1.2 * b.scale * BUSH_HIDE_FACTOR;
            if (Math.abs(b.x) - r <= s.width / 2 - 0.4) thicketReachable++;
          }
        }
      }

      // Охранники: ведьма на кольце вокруг сундука (если сундук и ведьмы есть).
      if (s.chests.length > 0 && s.witches.length > 0) {
        guardChecked++;
        const c = s.chests[0];
        const guard = s.witches[0];
        const d = Math.hypot(guard.x - c.x, guard.z - c.z);
        if (d >= 2.6 - 1e-6 && d <= 3.6 + 1e-6) guardOk++;
      }

      // Ниши: охранник стоит между входом и сундуком, дальше радиуса боя.
      for (const spur of s.sideSpurs) {
        spurChecked++;
        const d = Math.hypot(spur.witch.x - spur.chest.x, spur.witch.z - spur.chest.z);
        check(d >= 2.4 && d <= 5, `seed ${seed} #${s.index}: охранник ниши в ${d.toFixed(1)} м от сундука`);
        check(spur.witch.z < spur.chest.z, `seed ${seed} #${s.index}: охранник ниши должен стоять ближе ко входу, чем сундук`);
      }
    }
  }
  const avg = totalBushes / Math.max(1, sections);
  const avgTrees = totalTrees / Math.max(1, sections);
  realLog(
    `A: секций ${sections}, кустов ${avg.toFixed(1)}/секцию, деревьев ${avgTrees.toFixed(1)}/секцию, охранников у сундука ${guardOk}/${guardChecked}, ниш ${spurChecked}, зарослей у края ${thicketSeeds} (досягаемы ${thicketReachable})`
  );
  check(avg <= 7, `в среднем слишком много кустов: ${avg.toFixed(1)}`);
  check(avg >= 2, `в среднем слишком мало кустов: ${avg.toFixed(1)}`);
  check(avgTrees >= 3 && avgTrees <= 10, `деревьев в среднем ${avgTrees.toFixed(1)}/секцию — ожидали 3–10 (1–2 рощи)`);
  check(guardChecked > 15, "в выборке должны быть секции с сундуком и ведьмой");
  check(guardOk / guardChecked >= 0.9, `охранник рядом с сундуком только в ${guardOk}/${guardChecked} секций`);
  check(spurChecked > 0, "в выборке должны быть ниши");
  check(thicketSeeds > 50, "в выборке должны быть заросли у края коридора");
  check(thicketReachable / thicketSeeds >= 0.95, `в зарослях у края можно спрятаться лишь у ${thicketReachable}/${thicketSeeds} кустов (стена мешает дойти)`);
}

// ---------------------------------------------------------------------------
// B. StealthManager: невидимость и прозрачность (кусты, заросли у края, кроны)
// ---------------------------------------------------------------------------
{
  const engine = new NullEngine();
  // Берём мир, у спавна которого есть и заросли у края, и рощи. Каждый кандидат — в своей сцене
  // (иначе отвергнутые миры остаются в сцене с теми же именами мешей).
  let scene = new Scene(engine);
  let world = generateWorld(new GameState(), 1);
  let streamer: WorldStreamer | null = null;
  for (let seed = 1; seed <= 60 && !streamer; seed++) {
    scene = new Scene(engine);
    scene.collisionsEnabled = true;
    scene.activeCamera = new Camera("cam", Vector3.Zero(), scene);
    const gs = new GameState();
    world = generateWorld(gs, seed);
    const candidate = new WorldStreamer(scene, world, gs);
    candidate.update(world.spawnPoint.x, world.spawnPoint.z);
    const hasThicket = candidate.getActiveBushes().some((b) => b.kind === "thicket");
    const hasPlain = candidate.getActiveBushes().some((b) => b.kind === "bush");
    if (hasThicket && hasPlain && candidate.getActiveTrees().length > 0) streamer = candidate;
    else scene.dispose();
  }
  check(streamer !== null, "нашёлся мир с кустами, зарослями и рощей у спавна");
  if (!streamer) {
    console.log = realLog;
    console.error("нет подходящего мира");
    process.exit(1);
  }
  const camera = scene.activeCamera!;

  const bushes = streamer.getActiveBushes();
  const plain = bushes.filter((b) => b.kind === "bush");
  const thickets = bushes.filter((b) => b.kind === "thicket");
  const trees = streamer.getActiveTrees();
  check(plain.every((b) => scene.getMeshByName(b.mesh.name) === b.mesh && b.mesh.name.startsWith("bush")), "каждый куст — отдельный меш bush_*");
  check(trees.every((t) => scene.getMeshByName(t.canopy.name) === t.canopy), "каждая крона — отдельный меш");
  check(trees.every((t) => t.blockRadius > 0.5 && t.blockRadius < 1.1), "дерево перекрывает обзор кругом ~0.9 м на уровне глаз");
  check(
    trees.every((t, i) => {
      const col = scene.meshes.find((m) => m.name.startsWith("treeCol_") && Math.hypot(m.position.x - t.x, m.position.z - t.z) < 1e-6);
      return !!col && col.checkCollisions && !col.isVisible && i >= 0;
    }),
    "у каждого дерева есть невидимый ствол-коллайдер"
  );

  const player = { position: new Vector3(0, 1, 0), alpha: 1, setVisualAlpha(a: number) { this.alpha = a; } };
  const stealth = new StealthManager(scene, player as unknown as PlayerController, streamer);
  const settle = (frames = 90) => {
    for (let i = 0; i < frames; i++) stealth.update(1 / 60, false);
  };
  const farAway = () => player.position.set(world.spawnPoint.x, 1, world.spawnPoint.z); // точка спавна обычно вне кустов

  // --- отдельный куст ---
  const bush = plain[0];
  const inside = (b: { x: number; z: number; radius: number }, f: number) => new Vector3(b.x + b.radius * f, 1, b.z);
  player.position.copyFrom(inside(bush, BUSH_HIDE_FACTOR * 0.8));
  check(findHidingBush(bushes, player.position.x, player.position.z) !== null, "внутри 0.8 от порога — прячется");
  player.position.copyFrom(inside(bush, BUSH_HIDE_FACTOR * 1.15));
  const near = findHidingBush(bushes, player.position.x, player.position.z);
  check(near === null || near !== bush, "за порогом куста — не прячется");

  player.position.copyFrom(inside(bush, 0));
  stealth.update(1 / 60, false);
  check(stealth.isHidden, "в центре куста игрок спрятан");
  check(bush.mesh.visibility < 1 && bush.mesh.visibility > 0.3, "в первый кадр куст ещё плавно темнеет (не мгновенно)");
  settle();
  check(Math.abs(bush.mesh.visibility - 0.3) < 0.02, `куст стал полупрозрачным (${bush.mesh.visibility.toFixed(2)})`);
  check(Math.abs(player.alpha - 0.6) < 0.02, `игрок слегка прозрачен (${player.alpha.toFixed(2)})`);
  check(
    bushes.filter((b) => !bushCoversPlayer(b, player.position.x, player.position.z)).every((b) => b.alpha === 1),
    "кусты, не накрывающие игрока, остаются непрозрачными"
  );

  player.position.set(bush.x + bush.radius * 2.5, 1, bush.z);
  settle();
  const stillCovered = bushes.some((b) => bushCoversPlayer(b, player.position.x, player.position.z));
  check(!stealth.isHidden || stillCovered, "вне куста игрок виден");
  check(bush.mesh.visibility === 1, "прозрачность куста вернулась к 1");

  // --- заросли у края коридора ---
  const thicket = thickets[0];
  player.position.set(thicket.x, 1, thicket.z);
  stealth.update(1 / 60, false);
  check(stealth.isHidden, "в зарослях у края коридора игрок тоже спрятан");
  settle();
  const ghost = scene.getMeshByName(`${thicket.mesh.name}_ghost`);
  check(!!ghost && ghost.isEnabled() && Math.abs(ghost.visibility - 0.3) < 0.02, "вместо инстанса зарослей показан полупрозрачный двойник");
  check(!thicket.mesh.isEnabled(), "сам инстанс зарослей на это время выключен");
  const covering = thickets.filter((b) => bushCoversPlayer(b, player.position.x, player.position.z));
  check(covering.every((b) => b.alpha < 1), "все накрывающие игрока кусты зарослей (соседние перекрываются) прозрачны");
  check(thickets.filter((b) => !covering.includes(b)).every((b) => b.alpha === 1), "остальные заросли непрозрачны");
  farAway();
  settle();
  check(thicket.mesh.isEnabled() && (!ghost || !ghost.isEnabled()), "вышел из зарослей: инстанс вернулся, двойник скрыт");
  check(thickets.every((b) => b.alpha === 1), "и вся прозрачность вернулась");

  // --- кроны деревьев: прозрачны, когда между камерой и игроком ---
  const tree = trees[0];
  camera.position.set(tree.x, tree.canopyY, tree.z - 9);
  player.position.set(tree.x, 1, tree.z + 3); // дерево ровно на линии камера → игрок
  settle();
  check(Math.abs(tree.canopy.visibility - 0.3) < 0.02, `крона на линии камера→игрок стала прозрачной (${tree.canopy.visibility.toFixed(2)})`);
  player.position.set(tree.x + 15, 1, tree.z + 3); // игрок в стороне — крона больше не мешает
  settle();
  check(tree.canopy.visibility === 1, "крона вернулась к непрозрачной");

  // --- пауза (меню/бой): ведьмы стоят ---
  const w = streamer.getActiveWitches()[0];
  if (w) {
    player.position.set(w.position.x + 3, 1, w.position.z + 3);
    const before = w.position.clone();
    for (let i = 0; i < 120; i++) stealth.update(1 / 60, true);
    check(Vector3.Distance(before, w.position) < 1e-9, "при открытом меню ведьма не двигается");
  }
  scene.dispose();
}

// ---------------------------------------------------------------------------
// C. Witch.updateAi: движение, стены, стволы, видимость, территория
// ---------------------------------------------------------------------------
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.collisionsEnabled = true;
  scene.activeCamera = new Camera("cam", Vector3.Zero(), scene);
  const spell = ALL_SPELLS[0];

  const wall = MeshBuilder.CreateBox("walls_test", { width: 30, height: 2.5, depth: 0.4 }, scene);
  wall.position.set(0, 1.25, 4);
  wall.checkCollisions = true;
  wall.computeWorldMatrix(true);

  // C1. Стена не пропускает (даже если «видит» сквозь неё — LOS принудительно true).
  {
    const witch = new Witch(scene, new Vector3(0, 0, 0), spell, "c1", false);
    let crossed = false;
    for (let i = 0; i < 60 * 15; i++) {
      // Игрок за стеной и строго в конусе ведьмы.
      const yaw = witch.facingYaw;
      const px = witch.position.x + Math.sin(yaw) * 6;
      const pz = Math.max(8, witch.position.z + Math.cos(yaw) * 6);
      witch.updateAi(1 / 60, { playerX: px, playerZ: pz, playerHidden: false, paused: false, lineOfSight: () => true });
      if (witch.position.z > 3.4) crossed = true;
    }
    check(!crossed, `ведьма прошла сквозь стену (z=${witch.position.z.toFixed(2)})`);
    witch.dispose();
  }

  // C2. Без стены погоня идёт к игроку, медленно (после паузы узнавания).
  // Начальный курс ведьмы случаен (так и задумано), поэтому игрока ставим один раз — в конусе её
  // стартового взгляда — и дальше он стоит НА МЕСТЕ. Если же каждый кадр ставить его «перед глазами»
  // (по текущему курсу), цель вращается вместе с ведьмой и случайное «вилянье» замыкает её в петлю:
  // так тест падал примерно в 2–3 % запусков, хотя с ведьмой всё в порядке.
  {
    const witch = new Witch(scene, new Vector3(0, 0, -20), spell, "c2", false);
    const start = witch.position.clone();
    const startYaw = witch.facingYaw;
    const px = start.x + Math.sin(startYaw) * 7;
    const pz = start.z + Math.cos(startYaw) * 7;
    let maxStep = 0;
    let prev = witch.position.clone();
    let chased = false;
    let noticed = false;
    for (let i = 0; i < 60 * 8; i++) {
      witch.updateAi(1 / 60, { playerX: px, playerZ: pz, playerHidden: false, paused: false, lineOfSight: () => true });
      if (witch.aiState === "notice") noticed = true;
      if (witch.aiState === "chase") chased = true;
      maxStep = Math.max(maxStep, Math.hypot(witch.position.x - prev.x, witch.position.z - prev.z));
      prev = witch.position.clone();
    }
    check(noticed && chased, "ведьма увидела игрока в конусе, замерла на узнавание и начала погоню");
    check(Vector3.Distance(start, witch.position) > 1, "в погоне ведьма реально сдвинулась с места");
    check(maxStep * 60 <= 2.1 * 1.25 * 1.25 + 0.05, `скорость ведьмы ${(maxStep * 60).toFixed(2)} м/с — должна быть медленной`);
    check(witch.position.y <= 0.06, "походка не отрывает ведьму от пола больше чем на 6 см");
    witch.dispose();
  }

  // C3. Игрок в кусте — погони нет, даже если стоит прямо перед ведьмой.
  {
    const witch = new Witch(scene, new Vector3(0, 0, -20), spell, "c3", false);
    let chased = false;
    for (let i = 0; i < 60 * 8; i++) {
      const yaw = witch.facingYaw;
      witch.updateAi(1 / 60, {
        playerX: witch.position.x + Math.sin(yaw) * 3,
        playerZ: witch.position.z + Math.cos(yaw) * 3,
        playerHidden: true,
        paused: false,
        lineOfSight: () => true,
      });
      if (witch.aiState === "chase" || witch.aiState === "notice") chased = true;
    }
    check(!chased, "спрятанного в кусте игрока ведьма не замечает");
    witch.dispose();
  }

  // C4. Территория: чужая секция не провоцирует спокойную ведьму; ушёл за границу в погоне → наблюдение.
  {
    const calm = new Witch(scene, new Vector3(0, 0, -20), spell, "c4a", false);
    calm.sectionIndex = 3;
    let reacted = false;
    for (let i = 0; i < 60 * 8; i++) {
      const yaw = calm.facingYaw;
      calm.updateAi(1 / 60, {
        playerX: calm.position.x + Math.sin(yaw) * 5,
        playerZ: calm.position.z + Math.cos(yaw) * 5,
        playerHidden: false,
        playerSectionIndex: 4,
        paused: false,
        lineOfSight: () => true,
      });
      if (calm.aiState !== "idle" && calm.aiState !== "wander") reacted = true;
    }
    check(!reacted, "ведьма не реагирует на игрока, который в соседней секции");
    calm.dispose();

    const chaser = new Witch(scene, new Vector3(0, 0, -20), spell, "c4b", false);
    chaser.sectionIndex = 3;
    const ctxFor = (inSection: boolean) => {
      const yaw = chaser.facingYaw;
      return {
        playerX: chaser.position.x + Math.sin(yaw) * 6,
        playerZ: chaser.position.z + Math.cos(yaw) * 6,
        playerHidden: false,
        playerSectionIndex: inSection ? 3 : 4,
        paused: false,
        lineOfSight: () => true,
      };
    };
    let guard = 0;
    while (chaser.aiState !== "chase" && guard++ < 60 * 6) chaser.updateAi(1 / 60, ctxFor(true));
    check(chaser.aiState === "chase", "в своей секции ведьма гонится");
    for (let i = 0; i < 10; i++) chaser.updateAi(1 / 60, ctxFor(false));
    check(chaser.aiState === "watch", `игрок ушёл в другую секцию — ведьма стоит и смотрит (сейчас ${chaser.aiState})`);
    // Наблюдение «не вечное»: длится watchMin × терпение, а терпение у каждой ведьмы своё (случайное),
    // то есть не меньше ~2,4 с. Поэтому жёстко проверяем только эти первые 2 с; дальше — пока она ещё в
    // наблюдении, она стоит, а когда интерес угас (возврат домой) — двигаться уже можно.
    let watchFrames = 0; // кадров подряд с начала проверки, что она в наблюдении
    let stillWatching = true;
    let walkedWhileWatching = false;
    for (let i = 0; i < 60 * 12; i++) {
      const before = chaser.position.clone();
      chaser.updateAi(1 / 60, ctxFor(false));
      if (chaser.aiState === "watch") {
        if (Vector3.Distance(before, chaser.position) > 1e-6) walkedWhileWatching = true;
        if (stillWatching) watchFrames++;
      } else {
        stillWatching = false;
      }
    }
    check(watchFrames >= 60 * 2, `ведьма наблюдает не меньше 2 с, пока игрока видно (${(watchFrames / 60).toFixed(2)} с)`);
    check(!walkedWhileWatching, "в наблюдении ведьма не двигается");
    chaser.dispose();
  }

  // C5. Настоящий LOS через стену walls_*.
  {
    const gs = new GameState();
    const world = generateWorld(gs, 3);
    const streamer = new WorldStreamer(scene, world, gs);
    const player = { position: new Vector3(0, 1, 8), setVisualAlpha() {} };
    const stealth = new StealthManager(scene, player as unknown as PlayerController, streamer);
    const los = (stealth as unknown as { hasLineOfSight(a: number, b: number, c: number, d: number): boolean }).hasLineOfSight.bind(stealth);
    check(los(0, 0, 0, 8) === false, "луч через стену walls_* перекрыт");
    check(los(0, 0, 0, 2) === true, "до стены луч свободен");
    check(los(0, 8, 0, 20) === true, "за стеной, без неё на пути — свободен");
  }
  scene.dispose();
}

// ---------------------------------------------------------------------------
// D. Обзор: кусты, заросли и деревья перекрывают линию взгляда
// ---------------------------------------------------------------------------
{
  // D1. Чистая геометрия (cover.ts).
  const wall = [{ x: 0, z: 10, blockRadius: 0.85 }];
  check(isSightBlocked(0, 0, 0, 20, [wall]), "взгляд сквозь центр укрытия перекрыт");
  check(isSightBlocked(0.5, 0, 0.5, 20, [wall]), "взгляд через край укрытия (хорда > порога) перекрыт");
  check(!isSightBlocked(2, 0, 2, 20, [wall]), "взгляд мимо укрытия свободен");
  check(!isSightBlocked(0, 0, 0, 6, [wall]), "укрытие позади игрока (дальше цели) не мешает");
  check(!isSightBlocked(0.84, 0, 0.84, 20, [wall]), "скользящий по краю взгляд (хорда < порога) не считается перекрытым");
  check(isSightBlocked(0.8, 0, 0.8, 20, [wall]), "чуть глубже (хорда 0.57 м ≥ порога) — уже перекрыт");
  check(!isSightBlocked(0, 10, 0, 20, [wall]), "смотрящий внутри укрытия не слепнет");
  check(isSightBlocked(0, 0, 0, 10.4, [wall]), "игрок глубоко внутри укрытия (хорда ≥ порога) — перекрыт");
  check(!isSightBlocked(0, 0, 0, 9.3, [wall]), "игрок, едва коснувшийся края укрытия (хорда 0.15 м), виден");
  check(MIN_BLOCK_CHORD === 0.35, "порог перекрытия 0.35 м");
  check(!isSightBlocked(0, 0, 0, 9.0, [wall]), "игрок перед укрытием виден");
  check(isSightBlocked(0, 0, 0, 20, [[], wall]), "несколько списков укрытий проверяются вместе");
  check(Math.abs(eyeLevelRadius(1.2, 1.2) - Math.sqrt(1.44 - 0.04)) < 1e-9, "сечение сферы на высоте глаз");
  check(eyeLevelRadius(0.3, 0.3) === 0 && eyeLevelRadius(1, 5) === 0, "сфера, не достающая до уровня глаз, не перекрывает обзор");
  check(EYE_HEIGHT === 1.4, "высота глаз ведьмы 1.4");

  // D2. Через настоящий менеджер и настоящие чанки: куст/дерево между ведьмой и игроком — не видит.
  const engine = new NullEngine();
  let scene = new Scene(engine);
  let streamer: WorldStreamer | null = null;
  let world = generateWorld(new GameState(), 1);
  for (let seed = 1; seed <= 60 && !streamer; seed++) {
    scene = new Scene(engine);
    scene.collisionsEnabled = true;
    scene.activeCamera = new Camera("cam", Vector3.Zero(), scene);
    const gs = new GameState();
    world = generateWorld(gs, seed);
    const candidate = new WorldStreamer(scene, world, gs);
    candidate.update(world.spawnPoint.x, world.spawnPoint.z);
    if (candidate.getActiveBushes().some((b) => b.kind === "bush") && candidate.getActiveTrees().length > 0) streamer = candidate;
    else scene.dispose();
  }
  if (!streamer) {
    check(false, "нет мира с кустами и деревьями для проверки обзора");
  } else {
    const player = { position: new Vector3(world.spawnPoint.x, 1, world.spawnPoint.z), setVisualAlpha() {} };
    const stealth = new StealthManager(scene, player as unknown as PlayerController, streamer);
    stealth.update(1 / 60, false); // обновляет списки укрытий текущего кадра
    const los = (stealth as unknown as { hasLineOfSight(a: number, b: number, c: number, d: number): boolean }).hasLineOfSight.bind(stealth);

    const bush = streamer.getActiveBushes().find((b) => b.kind === "bush")!;
    check(los(bush.x, bush.z - 6, bush.x, bush.z - 5.9) === true, "рядом, без укрытия между ними — видно");
    check(los(bush.x, bush.z - 6, bush.x, bush.z + 6) === false, "куст между ведьмой и игроком перекрывает обзор");
    const tree = streamer.getActiveTrees()[0];
    check(los(tree.x, tree.z - 6, tree.x, tree.z + 6) === false, "дерево между ведьмой и игроком перекрывает обзор");
  }
  scene.dispose();
}

// ---------------------------------------------------------------------------
// D3. Стволы деревьев не пропускают (и без коллайдеров — пропустили бы)
// ---------------------------------------------------------------------------
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.collisionsEnabled = true;
  scene.activeCamera = new Camera("cam", Vector3.Zero(), scene);
  const gs = new GameState();
  let sectionWithTrees = null as null | ReturnType<typeof generateWorld>["sections"][number];
  let world = generateWorld(gs, 1);
  for (let seed = 1; seed <= 60 && !sectionWithTrees; seed++) {
    world = generateWorld(gs, seed);
    sectionWithTrees = world.sections.find((s) => s.trees.length >= 3) ?? null;
  }
  check(sectionWithTrees !== null, "нашлась секция с рощей");
  if (sectionWithTrees) {
    const index = new FootprintIndex(world.sections);
    const chunk = new SectionChunk(scene, sectionWithTrees, index);
    chunk.build(gs);
    for (const m of scene.meshes) m.computeWorldMatrix(true);
    const trees = chunk.treeVolumes;
    const t0 = trees[0];
    const spell = ALL_SPELLS[0];

    const probe = (id: string): number => {
      // Ведьма идёт прямо на ствол первого дерева с расстояния 4 м; смотрим, как близко подойдёт к стволам.
      const witch = new Witch(scene, new Vector3(t0.x - 4, 0, t0.z), spell, id, false);
      const walk = (witch as unknown as { walk(dt: number, vx: number, vz: number): void }).walk.bind(witch);
      let minDist = Infinity;
      for (let i = 0; i < 60 * 4; i++) {
        walk(1 / 60, 2, 0);
        for (const t of trees) minDist = Math.min(minDist, Math.hypot(witch.position.x - t.x, witch.position.z - t.z));
      }
      witch.dispose();
      return minDist;
    };
    const blocked = probe("d3a");
    check(blocked >= 0.4, `ведьма подошла к стволу на ${blocked.toFixed(2)} м — прошла сквозь дерево`);

    // Контроль: без коллайдеров тот же заход проходит сквозь ствол — значит, проверка что-то проверяет.
    for (const m of scene.meshes) if (m.name.startsWith("treeCol_")) m.checkCollisions = false;
    const free = probe("d3b");
    check(free < 0.3, `контрольный заход без коллайдеров должен пройти сквозь ствол (мин. ${free.toFixed(2)} м)`);
    chunk.dispose();
  }
  scene.dispose();
}

// ---------------------------------------------------------------------------
// E. ProximityDetector: спрятанный игрок и ведьма у сундука
// ---------------------------------------------------------------------------
{
  interface Stub {
    started: number;
    near?: string;
  }
  const build = (opts: { hidden: boolean; chestNear: boolean; friendly: boolean }) => {
    const out: Stub = { started: 0 };
    const witch = { id: "w", friendly: opts.friendly, spell: { id: "s", name: "S" }, position: new Vector3(0, 0, 0) };
    const player = { position: new Vector3(1.2, 0.9, 0) };
    const chest = { position: new Vector3(1.2, 0, 0.5), isOpened: false };
    const streamer = {
      getActiveBonfires: () => [],
      getActiveWitches: () => [witch],
      getActiveChests: () => (opts.chestNear ? [chest] : []),
      getActivePracticeTargets: () => [],
      getActiveGates: () => [],
    };
    const detector = new ProximityDetector({
      player: player as unknown as PlayerController,
      streamer: streamer as never,
      gameState: { isLearned: () => true, hasMaterials: () => true } as never,
      combat: { startEncounter: () => out.started++ } as never,
      hud: { setInteractHint() {}, setLockedHint() {} } as never,
      cooldown: new EncounterCooldown(),
      opponents: { witch: (w: unknown) => w, target: (t: unknown) => t } as never,
      isPlayerHidden: () => opts.hidden,
    });
    detector.update(false);
    return { out, detector, witch };
  };

  check(build({ hidden: false, chestNear: false, friendly: false }).out.started === 1, "враждебная ведьма рядом — бой начинается");
  check(build({ hidden: true, chestNear: false, friendly: false }).out.started === 0, "игрок в кусте — бой не начинается");
  check(build({ hidden: false, chestNear: true, friendly: false }).out.started === 1, "у сундука ведьма всё равно атакует (игрок не неуязвим)");
  const f1 = build({ hidden: false, chestNear: true, friendly: true });
  check(f1.detector.nearFriendlyWitch === null && f1.out.started === 0, "дружелюбная у сундука: приоритет у сундука (как раньше)");
  const f2 = build({ hidden: false, chestNear: false, friendly: true });
  check(f2.detector.nearFriendlyWitch === f2.witch, "дружелюбная рядом без других объектов — спарринг по E");
  check(build({ hidden: true, chestNear: false, friendly: true }).detector.nearFriendlyWitch !== null, "дружелюбной куст не мешает (спарринг доступен)");
}

console.log = realLog;
console.log(`Проверок: ${checks}, провалов: ${failures}`);
if (failures > 0) {
  console.error(`FAILED: ${failures}`);
  process.exit(1);
}
console.log("OK: стелс — генерация, кусты и прозрачность, коллизии/зрение ведьм, проксимити");
