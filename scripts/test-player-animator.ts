/**
 * test-player-animator.ts — оживление блочного персонажа (playerRig, PlayerAnimator, playerGestures).
 * Прогоняется в Node на NullEngine:
 *  A. Позы и ключевые кадры: sampleTrack, alt, mirror.
 *  B. Шарниры: в покое меши стоят там же, где у прежней «неподвижной» модели; рюкзак на спине на месте.
 *  C. Покой и походка: дыхание, противоход рук и ног, ноги не уходят в пол, остановка.
 *  D. Библиотека жестов: каждый играется целиком, плавно, не проваливается в пол, возвращается в нейтраль;
 *     смысл поз проверяется положением кистей (рука над головой, ладонь у лица, заклинание вперёд).
 *  E. Поведение: отмена шагом, приоритеты, замена жеста, случайный выбор без повторов подряд.
 *  F. Удерживаемые позы: сидит, боевая стойка, крадётся (ходьба продолжается).
 *  G. PlayerController: скорость и намерение, упор в стену (progress), заблокированный ввод, рюкзак едет с телом.
 */
import { NullEngine, Scene, Vector3, MeshBuilder } from "@babylonjs/core";
import type { Mesh } from "@babylonjs/core";
import { PlayerController } from "../src/core/PlayerController";
import { PlayerAnimator, groundOffset } from "../src/core/PlayerAnimator";
import type { PlayerMotion } from "../src/core/PlayerAnimator";
import { buildPlayerRig, HIP_Y } from "../src/core/playerRig";
import { CHANNELS, alt, sampleTrack } from "../src/core/playerPose";
import type { Channel, PoseValues } from "../src/core/playerPose";
import {
  ALERT_GESTURES,
  ARRIVAL_GESTURES,
  BLOCK_FOR_GUARD,
  BONK_GESTURES,
  CHALLENGE_GESTURES,
  GATE_OPENED_GESTURES,
  HIDDEN_ALERT_GESTURES,
  HIDE_GESTURES,
  LEARNED_GESTURES,
  REFRESHED_GESTURES,
  TIRED_GESTURES,
  TREASURE_GESTURES,
  WEARY_POSES,
  BURN_GESTURES,
  CHEST_GESTURES,
  DEFEAT_GESTURES,
  FIDGET_GESTURES,
  GATE_PUSH_GESTURES,
  GESTURES,
  GUARD_GESTURES,
  HELD_POSES,
  HIT_CHEER_GESTURES,
  HIT_RECOIL_GESTURES,
  IDLE_ACTION_GESTURES,
  MISS_GESTURES,
  RELIEF_GESTURES,
  SIT_POSES,
  SNEAK_POSES,
  STANCE_POSES,
  STUCK_GESTURES,
  VICTORY_GESTURES,
  mirror,
  mirrorPose,
} from "../src/core/playerGestures";
import type { GestureId } from "../src/core/playerGestures";

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  }
}
const near = (a: number, b: number, eps = 1e-3): boolean => Math.abs(a - b) <= eps;

const DT = 1 / 60;
const STAND: PlayerMotion = { speed: 0, intent: false, progress: 1 };
const RUN: PlayerMotion = { speed: 6.5, intent: true, progress: 1 };
const PUSH: PlayerMotion = { speed: 0, intent: true, progress: 0 };
const GESTURE_IDS = Object.keys(GESTURES) as GestureId[];

const engine = new NullEngine();
const scene = new Scene(engine);
scene.collisionsEnabled = true;

// ---------------------------------------------------------------------------
// A. Ключевые кадры
// ---------------------------------------------------------------------------
{
  const keys = [[0, 0], [1, 2], [2, 2], [3, 0]] as const;
  check(sampleTrack(keys, -1) === 0 && sampleTrack(keys, 10) === 0, "sampleTrack: вне диапазона — крайние значения");
  check(near(sampleTrack(keys, 0.5), 1) && near(sampleTrack(keys, 1.5), 2), "sampleTrack: середина участка — середина значений, полка держится");
  check(sampleTrack(keys, 0.25) < 0.5 && sampleTrack(keys, 0.75) > 1.5, "sampleTrack: плавный разгон и торможение (не линейно)");
  check(sampleTrack([], 1) === 0, "sampleTrack: пустая дорожка — 0");
  check(sampleTrack([[0, 0], [1, 5], [1, 7], [2, 7]], 1) === 7 && sampleTrack([[0, 0], [1, 5], [1, 7], [2, 7]], 0.999) < 5.01, "sampleTrack: два ключа в один момент — ступенька");
  const a = alt(1, 0.5, 4, 3, -3);
  check(a.length === 4 && a[0][1] === 3 && a[1][1] === -3 && a[2][1] === 3 && near(a[3][0], 2.5), "alt: значения чередуются, шаг по времени соблюдён");

  const m = mirror({ armRPitch: [[0, 1]], armRRoll: [[0, 0.5]], legLPitch: [[0, 2]], torsoYaw: [[0, 0.3]], headPitch: [[0, 0.1]], bodyY: [[0, 0.2]] });
  check(m.armLPitch?.[0][1] === 1 && m.armLRoll?.[0][1] === -0.5, "mirror: правая рука → левая, поворот вбок меняет знак, pitch — нет");
  check(m.legRPitch?.[0][1] === 2 && m.torsoYaw?.[0][1] === -0.3, "mirror: нога меняет сторону, курс торса меняет знак");
  check(m.headPitch?.[0][1] === 0.1 && m.bodyY?.[0][1] === 0.2, "mirror: наклон головы и прыжок не меняются");
  check(m.armRPitch === undefined && m.legLPitch === undefined, "mirror: прежних каналов не остаётся");
}

// ---------------------------------------------------------------------------
// B. Шарниры: поза покоя та же, что у прежней модели
// ---------------------------------------------------------------------------
const player = new PlayerController(scene, new Vector3(0, 0, 0), { isDown: () => false });
const an = player.animator;
const mesh = (name: string): Mesh => scene.getMeshByName(name) as Mesh;
const center = (name: string): Vector3 => {
  const m = mesh(name);
  m.computeWorldMatrix(true);
  return m.getAbsolutePosition();
};
/** Конец руки: середина нижней грани меша руки. */
const handTip = (name: "armL" | "armR"): Vector3 => {
  const m = mesh(name);
  m.computeWorldMatrix(true);
  return Vector3.TransformCoordinates(new Vector3(0, -0.375, 0), m.getWorldMatrix());
};
const bodyMeshes = scene.meshes.filter((m) => m.name !== "playerCollider") as Mesh[];
const lowestPoint = (): number => {
  let low = Infinity;
  for (const m of bodyMeshes) {
    m.computeWorldMatrix(true);
    low = Math.min(low, m.getBoundingInfo().boundingBox.minimumWorld.y);
  }
  return low;
};
const settle = (): void => {
  an.reset();
  player.collider.computeWorldMatrix(true);
};

{
  settle();
  const expected: Array<[string, number, number, number]> = [
    ["head", 0, 1.55, 0],
    ["torso", 0, 1.0, 0],
    ["armL", -0.5, 1.0, 0],
    ["armR", 0.5, 1.0, 0],
    ["legL", -0.2, 0.4, 0],
    ["legR", 0.2, 0.4, 0],
  ];
  for (const [name, x, y, z] of expected) {
    const c = center(name);
    check(near(c.x, x, 0.02) && near(c.y, y, 0.02) && near(c.z, z, 0.02), `в покое «${name}» на месте прежней модели (${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)})`);
  }
  const mount = player.backMount.node.getAbsolutePosition();
  check(near(mount.x, 0, 0.02) && near(mount.y, 1.0, 0.02) && near(mount.z, -0.2, 0.02), "точка крепления рюкзака — центр задней грани торса, как и раньше");
  check(near(lowestPoint(), 0, 0.02), "в покое ступни стоят на полу");

  // Меши — потомки визуала (setVisualAlpha идёт по getChildMeshes) и имён мало: нет дублей.
  const names = new Set(bodyMeshes.map((m) => m.name));
  check(["head", "torso", "armL", "armR", "legL", "legR"].every((n) => names.has(n)), "у персонажа есть голова, торс, обе руки и обе ноги");
  player.setVisualAlpha(0.4);
  check(["head", "torso", "armL", "armR", "legL", "legR"].every((n) => near(mesh(n).visibility, 0.4)), "прозрачность в кустах доходит до всех частей тела");
  player.setVisualAlpha(1);

  // Рюкзак висит на торсе, а не на корне.
  check(player.backMount.node.parent?.name === "playerTorso", "рюкзак закреплён на торсе (едет с телом)");
  check(near(groundOffset(0, 0), 0, 1e-9), "groundOffset: в покое поправки нет");
}

// ---------------------------------------------------------------------------
// C. Покой и походка
// ---------------------------------------------------------------------------
{
  settle();
  let maxArm = 0;
  let maxTorso = 0;
  for (let i = 0; i < 300; i++) {
    an.update(DT, STAND);
    maxArm = Math.max(maxArm, Math.abs(an.pose.armRPitch), Math.abs(an.pose.armLPitch));
    maxTorso = Math.max(maxTorso, Math.abs(an.pose.torsoPitch));
    check(near(an.pose.legLPitch, 0, 1e-9) && near(an.pose.legRPitch, 0, 1e-9), "в покое ноги неподвижны");
  }
  check(maxArm > 0.005 && maxArm < 0.06, `в покое руки чуть «дышат» (амплитуда ${maxArm.toFixed(3)})`);
  check(maxTorso > 0.005 && maxTorso < 0.03, `в покое грудь чуть «дышит» (амплитуда ${maxTorso.toFixed(3)})`);

  // Ход на полной скорости.
  settle();
  let maxLeg = 0;
  let minLeg = 0;
  let oppositeLegs = true;
  let armsOpposeLegs = true;
  let lowest = Infinity;
  let torsoLeanSum = 0;
  for (let i = 0; i < 120; i++) {
    an.update(DT, RUN);
    const p = an.pose;
    if (i > 30) {
      maxLeg = Math.max(maxLeg, p.legLPitch, p.legRPitch);
      minLeg = Math.min(minLeg, p.legLPitch, p.legRPitch);
      if (!near(p.legLPitch, -p.legRPitch, 1e-9)) oppositeLegs = false;
      // Левая нога вперёд (pitch < 0) → левая рука назад (pitch > 0): знаки pitch руки и ноги одной стороны противоположны.
      if (Math.abs(p.legLPitch) > 0.1 && p.legLPitch * p.armLPitch > 0) armsOpposeLegs = false;
      if (Math.abs(p.legRPitch) > 0.1 && p.legRPitch * p.armRPitch > 0) armsOpposeLegs = false;
      lowest = Math.min(lowest, lowestPoint());
      torsoLeanSum += p.torsoPitch;
    }
  }
  check(maxLeg > 0.5 && minLeg < -0.5 && maxLeg < 0.6 && minLeg > -0.6, `размах ног на бегу ≈ ±0.55 рад (${minLeg.toFixed(2)}…${maxLeg.toFixed(2)})`);
  check(oppositeLegs, "ноги качаются в противофазе");
  check(armsOpposeLegs, "рука одной стороны идёт против ноги той же стороны");
  check(lowest > -0.015, `за весь шаг ступни не проваливаются в пол (самая низкая точка ${lowest.toFixed(3)} м)`);
  check(torsoLeanSum / 89 > 0.07, "на бегу торс подан вперёд");
  check(an.walkAmount > 0.95, "полный ход — walkAmount ≈ 1");

  // Остановка: шаг затухает.
  for (let i = 0; i < 60; i++) an.update(DT, STAND);
  check(an.walkAmount === 0 && near(an.pose.legLPitch, 0, 1e-6), "после остановки походка гаснет, ноги встают ровно");

  // Фаза шага зависит от пройденного пути: медленный ход — мелкий шаг.
  settle();
  const slow: PlayerMotion = { speed: 1.3, intent: true, progress: 1 };
  let slowMax = 0;
  for (let i = 0; i < 200; i++) {
    an.update(DT, slow);
    slowMax = Math.max(slowMax, Math.abs(an.pose.legLPitch));
  }
  check(slowMax > 0.05 && slowMax < 0.2, `медленный ход — мелкий шаг (${slowMax.toFixed(2)} рад)`);

  // Упор в стену: ходьба не крутит ноги на месте.
  settle();
  for (let i = 0; i < 60; i++) an.update(DT, PUSH);
  check(an.walkAmount === 0, "упёрся в стену — ноги не бегут на месте");

  // Лаг не «перематывает» анимацию: один огромный dt равен одному короткому шагу.
  settle();
  an.update(5, RUN);
  check(CHANNELS.every((c) => Number.isFinite(an.pose[c])) && Math.abs(an.pose.legLPitch) <= 0.56, "огромный dt (лаг, пауза вкладки) не ломает позу и не «перематывает» шаг");
}

// ---------------------------------------------------------------------------
// D. Библиотека жестов
// ---------------------------------------------------------------------------
{
  // Гигиена данных.
  for (const id of GESTURE_IDS) {
    const def = GESTURES[id];
    check(def.duration > 0.5 && def.duration < 6, `«${id}»: разумная длительность (${def.duration} с)`);
    let sorted = true;
    let inRange = true;
    let valid = true;
    for (const [channel, keys] of Object.entries(def.tracks) as Array<[Channel, ReadonlyArray<readonly [number, number]>]>) {
      if (!CHANNELS.includes(channel)) valid = false;
      for (let i = 0; i < keys.length; i++) {
        if (i > 0 && keys[i][0] < keys[i - 1][0]) sorted = false;
        if (keys[i][0] < 0 || keys[i][0] > def.duration + 1e-6) inRange = false;
        if (!Number.isFinite(keys[i][1])) valid = false;
      }
    }
    check(sorted && inRange && valid, `«${id}»: ключи упорядочены, внутри длительности, каналы и числа корректны`);
    if (def.releaseAt !== undefined) check(def.releaseAt > 0.05 && def.releaseAt < def.duration - 0.2, `«${id}»: момент выпуска заклинания внутри жеста`);
  }
  for (const set of [IDLE_ACTION_GESTURES, FIDGET_GESTURES, STUCK_GESTURES, BURN_GESTURES, VICTORY_GESTURES]) {
    check(set.length >= 2 && set.every((id) => id in GESTURES), "наборы случайного выбора: ≥ 2 жестов, все существуют");
  }
  check(VICTORY_GESTURES.length >= 3, "для победы — несколько разных торжествующих жестов");
  check(["castRight", "castLeft", "castBoth"].every((id) => GESTURES[id as GestureId].releaseAt !== undefined), "у жестов каста есть момент выпуска");

  // Каждый жест играется целиком: плавно, не в пол, и сам заканчивается.
  for (const id of GESTURE_IDS) {
    settle();
    const def = GESTURES[id];
    // «Удар в защиту» — продолжение защиты: играет поверх соответствующей защиты, а не из нейтрали.
    const guardOfBlock = Object.entries(BLOCK_FOR_GUARD).find(([, block]) => block === id)?.[0] as GestureId | undefined;
    if (guardOfBlock) {
      an.play(guardOfBlock);
      for (let i = 0; i < 40; i++) an.update(DT, STAND);
    }
    check(an.play(id), `«${id}»: запускается`);
    let prev: PoseValues = { ...an.pose };
    let maxJump = 0;
    let low = Infinity;
    let finite = true;
    const frames = Math.ceil((def.duration + 0.6) / DT);
    for (let i = 0; i < frames; i++) {
      an.update(DT, STAND);
      const p = an.pose;
      for (const c of CHANNELS) {
        if (!Number.isFinite(p[c])) finite = false;
        const d = c === "bodyYaw" ? Math.abs(Math.atan2(Math.sin(p[c] - prev[c]), Math.cos(p[c] - prev[c]))) : Math.abs(p[c] - prev[c]);
        if (d > maxJump) maxJump = d;
      }
      prev = { ...p };
      low = Math.min(low, lowestPoint());
    }
    check(finite, `«${id}»: все значения конечны`);
    check(maxJump < 0.45, `«${id}»: плавно, без рывков (макс. скачок за кадр ${maxJump.toFixed(3)})`);
    check(low > -0.03, `«${id}»: тело не уходит в пол (низшая точка ${low.toFixed(3)} м)`);
    check(an.currentGesture === null && !an.isBusy, `«${id}»: после конца жест снят`);
  }

  // Возврат в нейтраль: жест + двойник без жеста в одинаковых условиях дают ту же позу.
  for (const id of GESTURE_IDS) {
    settle();
    an.play(id);
    for (let i = 0; i < Math.ceil((GESTURES[id].duration + 0.6) / DT); i++) an.update(DT, STAND);
    const after = { ...an.pose };
    settle();
    for (let i = 0; i < Math.ceil((GESTURES[id].duration + 0.6) / DT); i++) an.update(DT, STAND);
    const plain = { ...an.pose };
    let worst = 0;
    for (const c of CHANNELS) worst = Math.max(worst, c === "bodyYaw" ? Math.abs(Math.atan2(Math.sin(after[c] - plain[c]), Math.cos(after[c] - plain[c]))) : Math.abs(after[c] - plain[c]));
    check(worst < 1e-3, `«${id}»: после жеста поза совпадает с позой без жеста (расхождение ${worst.toExponential(1)})`);
  }
}

// Смысл поз: где оказываются кисти.
const runTo = (id: GestureId, t: number, motion: PlayerMotion = STAND): void => {
  settle();
  an.play(id);
  for (let i = 0; i < Math.round(t / DT); i++) an.update(DT, motion);
};
{
  const HEAD_TOP = 1.8;
  runTo("scratchHead", 0.9);
  const tip = handTip("armR");
  check(tip.y > HEAD_TOP && tip.y < 2.3 && Math.abs(tip.x) < 0.4, `почесал голову: кисть над головой (${tip.x.toFixed(2)}, ${tip.y.toFixed(2)})`);

  runTo("facepalm", 0.8);
  const face = handTip("armR");
  check(Vector3.Distance(face, new Vector3(0, 1.62, 0.3)) < 0.4, `фейспалм: кисть у лица (дистанция ${Vector3.Distance(face, new Vector3(0, 1.62, 0.3)).toFixed(2)} м)`);

  runTo("relief", 0.9);
  const brow = handTip("armR");
  check(Vector3.Distance(brow, new Vector3(0, 1.62, 0.3)) < 0.45, "отступил: вытирает лоб — кисть у лица");

  runTo("wave", 0.9);
  const wave = handTip("armR");
  check(wave.y > 1.9 && wave.x > 0.5, `помахал: рука поднята вверх и в сторону (${wave.x.toFixed(2)}, ${wave.y.toFixed(2)})`);

  runTo("stretch", 1.5);
  check(handTip("armL").y > 1.95 && handTip("armR").y > 1.95, "потянулся: обе руки выше головы");
  check(an.pose.torsoPitch < -0.15, "потянулся: спина прогнулась назад");

  runTo("victoryArmsUp", 0.8);
  check(handTip("armL").y > 2.0 && handTip("armR").y > 2.0, "победа: обе руки подняты вверх");

  runTo("shrug", 0.6);
  check(handTip("armR").x > 0.75 && handTip("armL").x < -0.75, "пожал плечами: руки разведены в стороны");

  runTo("sit", 1.5);
  check(an.pose.bodyY < -0.4, `присел: тело опустилось (${an.pose.bodyY.toFixed(2)} м)`);
  check(handTip("armR").y < 0.5 && handTip("armR").z > 0.4, "присел: ладони на коленях, а не в воздухе");
  check(near(lowestPoint(), 0, 0.03), "присел: сидит на земле, а не висит и не провалился");
  player.backMount.node.computeWorldMatrix(true);
  const sitMount = player.backMount.node.getAbsolutePosition();
  check(sitMount.y < 0.7, `присел: рюкзак опустился вместе с телом (y = ${sitMount.y.toFixed(2)})`);

  runTo("burnHopA", 0.14);
  check(an.pose.bodyY > 0.45, `костёр (A): прыжок вверх (${an.pose.bodyY.toFixed(2)} м)`);
  runTo("burnHopB", 0.12);
  check(an.pose.bodyY > 0.2 && an.pose.legRPitch < -1, "костёр (B): подскок на одной ноге, вторая поджата");

  runTo("victorySpin", 1.1);
  check(near(Math.cos(an.pose.bodyYaw), 1, 0.05), "волчок: к концу оборота персонаж снова лицом вперёд");
  runTo("victorySpin", 0.55);
  check(Math.abs(Math.sin(an.pose.bodyYaw)) > 0.5 || Math.cos(an.pose.bodyYaw) < 0.5, "волчок: на середине персонаж развёрнут");

  runTo("victoryBow", 1.0);
  check(an.pose.torsoPitch > 0.8, "поклон: торс глубоко наклонён");

  // Касты: к моменту выпуска нужная рука уже направлена вперёд.
  const forward = (name: "armL" | "armR"): number => handTip(name).z;
  for (const [id, hands] of [["castRight", ["armR"]], ["castLeft", ["armL"]], ["castBoth", ["armL", "armR"]], ["castPoint", ["armR"]], ["castCircle", ["armR"]]] as const) {
    runTo(id, GESTURES[id].releaseAt!);
    for (const h of hands) check(forward(h) > 0.6, `${id}: к моменту выпуска ${h} вытянута вперёд (z = ${forward(h).toFixed(2)})`);
  }
  runTo("castOverhead", GESTURES.castOverhead.releaseAt!);
  check(handTip("armR").z > 0.5 && handTip("armR").y < 1.6, "castOverhead: к выпуску руки уже рубят вперёд-вниз, а не тянутся вверх");
  runTo("castOverhead", 0.35);
  check(handTip("armR").y > 2.0 && handTip("armL").y > 2.0, "castOverhead: перед ударом обе руки над головой");
  runTo("castLeft", GESTURES.castLeft.releaseAt!);
  check(forward("armR") < 0.3, "castLeft: правая рука при броске левой не тянется вперёд");

  // Зеркальность: castLeft — отражение castRight.
  let mirrored = true;
  for (let t = 0; t <= 0.95; t += 0.05) {
    const r = (c: Channel): number => sampleTrack(GESTURES.castRight.tracks[c] ?? [], t);
    const l = (c: Channel): number => sampleTrack(GESTURES.castLeft.tracks[c] ?? [], t);
    if (!near(r("armRPitch"), l("armLPitch")) || !near(r("armRRoll"), -l("armLRoll")) || !near(r("torsoYaw"), -l("torsoYaw")) || !near(r("legLPitch"), l("legRPitch"))) mirrored = false;
  }
  check(mirrored, "castLeft — точное зеркало castRight");

  // Боевые реакции.
  runTo("guard", 0.6);
  check(handTip("armR").y > 1.4 && handTip("armL").y > 1.4 && an.pose.torsoPitch > 0.1, "защита: руки перед лицом, пригнулся");
  runTo("hitRecoil", 0.12);
  check(an.pose.torsoPitch < -0.3 && an.pose.armRRoll > 0.5, "удар попал: отбросило назад, руки в стороны");
  runTo("bonk", 0.1);
  check(an.pose.torsoPitch < -0.2, "ткнулся в стену: откинуло назад");
}

// ---------------------------------------------------------------------------
// D2. Разнообразие: у каждого действия несколько жестов, и все они разумны
// ---------------------------------------------------------------------------
{
  const pools: Array<[string, readonly string[], number]> = [
    ["«действие» без цели", IDLE_ACTION_GESTURES, 8],
    ["занятия от скуки", FIDGET_GESTURES, 5],
    ["упёрся и стоит", STUCK_GESTURES, 4],
    ["налетел на стену", BONK_GESTURES, 3],
    ["наступил на костёр", BURN_GESTURES, 3],
    ["открыл сундук", CHEST_GESTURES, 3],
    ["барьер", GATE_PUSH_GESTURES, 3],
    ["защита", GUARD_GESTURES, 3],
    ["удар попал", HIT_RECOIL_GESTURES, 3],
    ["свой удар попал", HIT_CHEER_GESTURES, 3],
    ["свой удар промахнулся", MISS_GESTURES, 3],
    ["победа", VICTORY_GESTURES, 6],
    ["поражение", DEFEAT_GESTURES, 3],
    ["отступление", RELIEF_GESTURES, 3],
    ["посадка у костра", SIT_POSES, 3],
    ["боевая стойка", STANCE_POSES, 3],
    ["стелс", SNEAK_POSES, 3],
  ];
  for (const [name, pool, min] of pools) {
    check(pool.length >= min, `${name}: не меньше ${min} вариантов (сейчас ${pool.length})`);
    check(new Set(pool).size === pool.length, `${name}: варианты не повторяются`);
  }
  for (const id of [...IDLE_ACTION_GESTURES, ...STUCK_GESTURES, ...BONK_GESTURES, ...BURN_GESTURES, ...CHEST_GESTURES, ...GATE_PUSH_GESTURES, ...GUARD_GESTURES, ...HIT_RECOIL_GESTURES, ...HIT_CHEER_GESTURES, ...MISS_GESTURES, ...VICTORY_GESTURES, ...DEFEAT_GESTURES, ...RELIEF_GESTURES]) {
    check(id in GESTURES, `жест «${id}» из набора существует`);
  }
  for (const id of [...SIT_POSES, ...STANCE_POSES, ...SNEAK_POSES]) check(id in HELD_POSES, `поза «${id}» из набора существует`);

  // Каждой защите соответствует «удар в неё»: те же каналы, и он начинается там, где защита кончается.
  for (const guard of GUARD_GESTURES) {
    const block = BLOCK_FOR_GUARD[guard];
    check(block !== undefined && block in GESTURES, `у защиты «${guard}» есть пара «удар в защиту»`);
    if (!block) continue;
    const g = GESTURES[guard].tracks;
    const b = GESTURES[block].tracks;
    const missing = (Object.keys(g) as Channel[]).filter((c) => b[c] === undefined);
    check(missing.length === 0, `«${block}» ведёт все каналы защиты «${guard}» (нет: ${missing.join(",") || "—"})`);
    let seamless = true;
    for (const c of Object.keys(g) as Channel[]) {
      const end = sampleTrack(g[c]!, GESTURES[guard].duration);
      const start = sampleTrack(b[c] ?? [], 0);
      if (Math.abs(end - start) > 0.011) seamless = false;
    }
    check(seamless, `«${block}» начинается ровно в позе, где кончается «${guard}» (без скачка)`);
  }
  check(["guard", "guardShield", "guardCrouch"].every((g) => GESTURES[g as GestureId].priority === 2), "защиты имеют боевой приоритет");

  // Боевые стойки: левая и правая — зеркала друг друга; ноги не проваливаются.
  const left = HELD_POSES.battleStance.values;
  const right = HELD_POSES.battleStanceMirror.values;
  const mirrored = mirrorPose(left);
  check(Object.keys(mirrored).every((c) => near((right as Record<string, number>)[c] ?? NaN, (mirrored as Record<string, number>)[c], 1e-9)) && Object.keys(right).length === Object.keys(mirrored).length, "стойка с правой ноги — зеркало стойки с левой");
  check(right.legRPitch! < 0 && left.legLPitch! < 0, "в стойках вперёд выставлена то левая, то правая нога");

  for (const id of STANCE_POSES) {
    settle();
    an.setHeld(id);
    for (let i = 0; i < 60; i++) an.update(DT, STAND);
    check(lowestPoint() > -0.03 && lowestPoint() < 0.06, `стойка «${id}»: ноги стоят на земле (${lowestPoint().toFixed(3)} м)`);
    an.setHeld(null);
  }
  for (const id of SIT_POSES) {
    settle();
    an.setHeld(id);
    for (let i = 0; i < 90; i++) an.update(DT, STAND);
    check(an.pose.bodyY < -0.4 && near(an.pose.legLPitch, -1.57, 0.02), `«${id}»: сидит на земле, ноги вперёд`);
    check(lowestPoint() > -0.05 && lowestPoint() < 0.08, `«${id}»: не висит и не проваливается (${lowestPoint().toFixed(3)} м)`);
    an.setHeld(null);
  }
  const sitPoses = SIT_POSES.map((id) => {
    settle();
    an.setHeld(id);
    for (let i = 0; i < 90; i++) an.update(DT, STAND);
    const p = { torso: an.pose.torsoPitch, arm: an.pose.armRPitch };
    an.setHeld(null);
    return p;
  });
  check(new Set(sitPoses.map((p) => `${p.torso.toFixed(1)}/${p.arm.toFixed(1)}`)).size === SIT_POSES.length, "позы сидения заметно отличаются друг от друга");
  for (const id of SNEAK_POSES) {
    settle();
    an.setHeld(id);
    let legMax = 0;
    for (let i = 0; i < 120; i++) {
      an.update(DT, RUN);
      legMax = Math.max(legMax, Math.abs(an.pose.legLPitch));
    }
    check(legMax > 0.4 && an.pose.torsoPitch > 0.25, `«${id}»: пригнулся, но шагает`);
    an.setHeld(null);
  }
}

// Смысл новых поз: где оказываются кисти и как идут ноги.
{
  const peak = (id: GestureId, t0: number, t1: number, read: () => number, pick: "min" | "max"): number => {
    settle();
    an.play(id);
    let best = pick === "max" ? -Infinity : Infinity;
    for (let i = 0; i < Math.round(t1 / DT); i++) {
      an.update(DT, STAND);
      if (i * DT >= t0) best = pick === "max" ? Math.max(best, read()) : Math.min(best, read());
    }
    return best;
  };
  const signChanges = (id: GestureId, ch: Channel, t1: number): number => {
    settle();
    an.play(id);
    let last = 0;
    let n = 0;
    for (let i = 0; i < Math.round(t1 / DT); i++) {
      an.update(DT, STAND);
      const v = an.pose[ch];
      const s = Math.abs(v) < 0.05 ? 0 : Math.sign(v);
      if (s !== 0 && last !== 0 && s !== last) n++;
      if (s !== 0) last = s;
    }
    return n;
  };
  const FACE = new Vector3(0, 1.62, 0.3);

  runTo("reliefChest", 0.9);
  check(Vector3.Distance(handTip("armR"), new Vector3(0, 1.2, 0.3)) < 0.35, "отдышался: ладонь лежит на груди");
  runTo("bonkNose", 0.5);
  check(Vector3.Distance(handTip("armR"), FACE) < 0.4, "ткнулся носом: рука у лица");
  runTo("yawn", 1.2);
  check(handTip("armL").y > 1.9 && handTip("armR").y > 1.9 && an.pose.headPitch < -0.35, "зевнул: руки вверх, голова назад");
  check(peak("hopHappy", 0, 0.5, () => an.pose.bodyY, "max") > 0.15, "подпрыгнул от нечего делать");
  runTo("tapFoot", 1.0);
  check(handTip("armR").x < 0.15 && handTip("armL").x > -0.15, "руки скрещены на груди (кисти перешли на другую сторону)");
  check(peak("tapFoot", 0, 2, () => an.pose.legRPitch, "min") < -0.3, "постукивает ногой");
  runTo("lookUp", 1.2);
  check(an.pose.headPitch < -0.4 && handTip("armR").z < 0 && handTip("armL").z < 0, "смотрит в небо, руки за спиной");
  check(peak("rollShoulders", 0, 1.5, () => an.pose.torsoYaw, "max") > 0.25 && peak("rollShoulders", 0, 1.5, () => an.pose.torsoYaw, "min") < -0.25, "разминает плечи: корпус поворачивается в обе стороны");
  check(signChanges("shuffleDance", "legLPitch", 2.5) >= 3, "пританцовывает: ноги меняются");
  check(signChanges("burnHopC", "legLPitch", 1.3) >= 4, "«горячо!»: частит ногами на месте");
  check(peak("burnHopC", 0, 1.3, () => an.pose.bodyY, "max") > 0.12, "«горячо!»: подскакивает");

  runTo("openChestKneel", 0.9);
  check(an.pose.legLPitch < -1 && an.pose.legRPitch > 0.5, "сундук: опустился на колено (одна нога вперёд, другая назад)");
  runTo("openChestLift", 0.9);
  check(handTip("armL").y > 1.85 && handTip("armR").y > 1.85, "сундук: поднял крышку обеими руками");
  runTo("pushGateShoulder", 0.8);
  check(an.pose.torsoYaw > 0.4 && an.pose.legRPitch > 0.3, "барьер: навалился плечом, ноги упёрты");
  const knock = [] as number[];
  settle();
  an.play("pushGateKnock");
  for (let i = 0; i < Math.round(1.3 / DT); i++) {
    an.update(DT, STAND);
    if (i * DT > 0.5) knock.push(handTip("armR").z);
  }
  check(Math.max(...knock) > 0.6 && Math.max(...knock) - Math.min(...knock) > 0.2, "барьер: стучит кулаком (рука ходит вперёд-назад)");

  runTo("guardShield", 0.6);
  check(handTip("armR").y > 1.2 && handTip("armR").z > 0.4 && an.pose.torsoYaw > 0.4, "защита щитом: рука вперёд, корпус боком");
  runTo("guardCrouch", 0.6);
  check(handTip("armL").y > 1.3 && handTip("armR").y > 1.3 && an.pose.torsoPitch > 0.5, "защита пригнувшись: руки над головой, корпус согнут");
  runTo("hitRecoilSpin", 0.2);
  check(an.pose.bodyYaw > 0.6, "отдача: развернуло боком");
  runTo("hitRecoilKnee", 0.4);
  check(an.pose.torsoPitch > 0.3 && an.pose.legLPitch < -0.8, "отдача: согнулся, колено подогнулось");
  runTo("hitCheerBoth", 0.2);
  check(handTip("armL").y > 1.7 && handTip("armR").y > 1.7, "«есть!» обеими руками: кулаки вверх");
  runTo("hitCheerPoint", 0.6);
  check(handTip("armR").z > 0.6 && handTip("armR").y > 1.1, "«есть!» пальцем: указывает на цель");
  check(peak("missStomp", 0, 0.5, () => an.pose.legRPitch, "min") < -0.5, "промах: топнул ногой");
  check(peak("missHeadShake", 0, 1.5, () => an.pose.headYaw, "max") > 0.35 && peak("missHeadShake", 0, 1.5, () => an.pose.headYaw, "min") < -0.35, "промах: качает головой из стороны в сторону");

  runTo("victoryFlex", 1.0);
  check(handTip("armR").x > 1.0 && handTip("armL").x < -1.0, "победа: руки раскинуты в стороны");
  check(peak("victoryJump", 0, 1.3, () => an.pose.bodyY, "max") > 0.4 && peak("victoryJump", 0.8, 1.3, () => an.pose.bodyY, "max") > 0.45, "победа: большие прыжки");
  runTo("defeatCollapse", 1.5);
  check(an.pose.torsoPitch > 0.7, "поражение: обмяк, корпус свесился");
  check(peak("defeatSkyward", 0, 1.2, () => an.pose.headPitch, "min") < -0.45 && peak("defeatSkyward", 1.8, 2.4, () => an.pose.headPitch, "max") > 0.4, "поражение: голову к небу, потом на грудь");
  check(signChanges("reliefShake", "armRPitch", 1.2) >= 4, "отступление: стряхивает напряжение (руки болтаются)");
}

// ---------------------------------------------------------------------------
// D3. События мира: наборы, «верх тела», новые позы
// ---------------------------------------------------------------------------
{
  const pools: Array<[string, readonly string[]]> = [
    ["заметила ведьма", ALERT_GESTURES],
    ["заметила ведьма (в кустах)", HIDDEN_ALERT_GESTURES],
    ["нырнул в куст", HIDE_GESTURES],
    ["устал", TIRED_GESTURES],
    ["отдохнул", REFRESHED_GESTURES],
    ["новое место", ARRIVAL_GESTURES],
    ["выучил заклинание", LEARNED_GESTURES],
    ["барьер разрушен", GATE_OPENED_GESTURES],
    ["находка", TREASURE_GESTURES],
    ["вызов на бой", CHALLENGE_GESTURES],
  ];
  for (const [name, pool] of pools) {
    check(pool.length >= 3 && new Set(pool).size === pool.length && pool.every((id) => id in GESTURES), `${name}: не меньше трёх разных жестов, все существуют`);
  }

  // Жесты «верха тела» не трогают ноги и тело: их можно играть на ходу и сидя у костра.
  for (const [name, pool] of [["новое место", ARRIVAL_GESTURES], ["выучил заклинание", LEARNED_GESTURES], ["барьер разрушен", GATE_OPENED_GESTURES], ["находка", TREASURE_GESTURES]] as const) {
    for (const id of pool) {
      const tr = GESTURES[id].tracks;
      const lower = (["legLPitch", "legRPitch", "bodyY", "bodyYaw"] as Channel[]).filter((c) => tr[c] !== undefined);
      check(lower.length === 0, `«${id}» (${name}) ведёт только верх тела — можно играть на ходу и сидя (нижние каналы: ${lower.join(",") || "—"})`);
      check(GESTURES[id].cancelOnMove === undefined, `«${id}»: не обрывается шагом`);
    }
  }
  for (const id of ARRIVAL_GESTURES) {
    settle();
    an.play(id);
    let legMax = 0;
    for (let i = 0; i < 90; i++) {
      an.update(DT, RUN);
      legMax = Math.max(legMax, Math.abs(an.pose.legLPitch));
    }
    check(an.currentGesture === id && legMax > 0.4, `«${id}»: играет на бегу, а ноги продолжают шагать`);
  }
  for (const id of [...LEARNED_GESTURES, ...GATE_OPENED_GESTURES, ...TREASURE_GESTURES]) {
    settle();
    an.setHeld("sit");
    for (let i = 0; i < 60; i++) an.update(DT, STAND);
    an.play(id);
    let low = Infinity;
    let sitting = true;
    for (let i = 0; i < Math.round(GESTURES[id].duration / DT); i++) {
      an.update(DT, STAND);
      low = Math.min(low, lowestPoint());
      if (an.pose.bodyY > -0.4 || an.pose.legLPitch > -1.4) sitting = false;
    }
    check(sitting && low > -0.1, `«${id}»: играет, пока герой сидит у костра (он не вскакивает и не проваливается, ${low.toFixed(3)} м)`);
    an.setHeld(null);
  }

  // Усталость: ссутулился, но шагает; ноги на земле.
  settle();
  an.setHeld("weary");
  let legMax = 0;
  for (let i = 0; i < 120; i++) {
    an.update(DT, RUN);
    legMax = Math.max(legMax, Math.abs(an.pose.legLPitch));
  }
  check(WEARY_POSES.includes("weary") && an.pose.torsoPitch > 0.2 && an.pose.headPitch > 0.1 && legMax > 0.4, "усталый: плечи опущены, голова повисла, но идёт");
  an.setHeld(null);

  const FACE = new Vector3(0, 1.62, 0.3);
  const CHEST = new Vector3(0, 1.2, 0.3);
  const peak = (id: GestureId, t1: number, read: () => number, pick: "min" | "max"): number => {
    settle();
    an.play(id);
    let best = pick === "max" ? -Infinity : Infinity;
    for (let i = 0; i < Math.round(t1 / DT); i++) {
      an.update(DT, STAND);
      best = pick === "max" ? Math.max(best, read()) : Math.min(best, read());
    }
    return best;
  };
  const flips = (id: GestureId, ch: Channel, t1: number): number => {
    settle();
    an.play(id);
    let last = 0;
    let n = 0;
    for (let i = 0; i < Math.round(t1 / DT); i++) {
      an.update(DT, STAND);
      const s = Math.abs(an.pose[ch]) < 0.05 ? 0 : Math.sign(an.pose[ch]);
      if (s !== 0 && last !== 0 && s !== last) n++;
      if (s !== 0) last = s;
    }
    return n;
  };

  check(peak("startle", 0.3, () => an.pose.bodyY, "max") > 0.12, "вздрогнул: подпрыгнул");
  runTo("startle", 0.15);
  check(handTip("armR").x > 0.8 && handTip("armL").x < -0.8 && an.pose.torsoPitch < -0.2, "вздрогнул: руки в стороны, откинулся");
  runTo("gulp", 0.8);
  check(Vector3.Distance(handTip("armR"), CHEST) < 0.4 && Vector3.Distance(handTip("armL"), CHEST) < 0.4, "сглотнул: обе ладони у груди");
  check(peak("glance", 1.4, () => an.pose.headYaw, "max") > 0.6 && peak("glance", 1.4, () => an.pose.headYaw, "min") < -0.6, "резко оглянулся в обе стороны");
  runTo("holdBreath", 0.8);
  check(Vector3.Distance(handTip("armR"), FACE) < 0.4, "затаил дыхание: ладонь у рта");
  runTo("freeze", 0.8);
  check(handTip("armR").x < 0.2 && handTip("armL").x > -0.2, "замер: руки прижаты к груди");
  check(peak("freeze", 1.6, () => an.pose.torsoRoll, "max") > 0.02 && peak("freeze", 1.6, () => an.pose.torsoRoll, "min") < -0.02, "замер: мелкая дрожь");
  runTo("peek", 1.0);
  check(an.pose.torsoRoll > 0.2 && an.pose.headYaw > 0.4, "выглядывает из-за листьев: наклонился и повернул голову");
  runTo("hideDuck", 0.2);
  const headNow = (): Vector3 => {
    const m = scene.getMeshByName("head")!;
    m.computeWorldMatrix(true);
    return m.getAbsolutePosition();
  };
  check(an.pose.torsoPitch > 0.6 && Vector3.Distance(handTip("armR"), headNow()) < 0.6 && Vector3.Distance(handTip("armL"), headNow()) < 0.6, "нырнул в куст: пригнулся и накрыл голову руками (кисти рядом с головой)");
  runTo("hideDive", 0.25);
  check(an.pose.torsoPitch > 0.55 && handTip("armR").z > 0.6 && handTip("armL").z > 0.6, "нырнул в куст: головой вперёд, руки перед собой");
  runTo("hideTuck", 0.4);
  check(an.pose.torsoPitch > 0.45 && handTip("armR").x < 0.2 && handTip("armL").x > -0.2, "нырнул в куст: сжался, руки на груди");

  runTo("pantKnees", 1.5);
  check(an.pose.torsoPitch > 0.5 && handTip("armR").y < 0.8 && handTip("armL").y < 0.8 && handTip("armR").z > 0.1 && handTip("armL").z > 0.1 && Math.abs(handTip("armR").x) < 0.45, "устал: согнулся, ладони на коленях (впереди, а не за спиной)");
  check(lowestPoint() > -0.03, "устал: ноги на земле");
  runTo("tiredSlump", 1.2);
  check(an.pose.torsoPitch > 0.25 && an.pose.headPitch > 0.35, "устал: плечи упали, голова повисла");
  runTo("tiredWipe", 1.0);
  check(Vector3.Distance(handTip("armR"), FACE) < 0.45, "устал: вытирает пот со лба");

  runTo("arriveVisor", 0.8);
  check(handTip("armR").y > 1.6 && Math.abs(handTip("armR").x) < 0.3 && handTip("armR").z > 0.15, "новое место: ладонь козырьком над глазами");
  runTo("arrivePoint", 0.8);
  check(handTip("armR").z > 0.5 && handTip("armR").y > 1.4, "новое место: показывает рукой вдаль");
  runTo("arriveBreath", 1.0);
  check(handTip("armR").x > 0.9 && handTip("armL").x < -0.9 && an.pose.torsoPitch < -0.08, "новое место: руки раскинуты, грудь вперёд");

  runTo("eureka", 0.8);
  check(handTip("armR").y > 2.0, "эврика: палец вверх");
  runTo("hugBook", 0.9);
  check(Vector3.Distance(handTip("armR"), CHEST) < 0.4 && Vector3.Distance(handTip("armL"), CHEST) < 0.4, "выучил: прижал знание к груди");
  check(flips("fistSmall", "armRPitch", 1.0) === 0 && peak("fistSmall", 1.0, () => handTip("armR").y, "max") > 1.7, "выучил: кулак вверх");
  runTo("clapDust", 0.9);
  check(handTip("armR").z > 0.5 && handTip("armL").z > 0.5, "барьер: руки перед собой, отряхивает ладони");
  check(flips("nodSatisfied", "headPitch", 1.4) === 0 && peak("nodSatisfied", 1.4, () => an.pose.headPitch, "max") > 0.25, "барьер: довольно кивает");
  runTo("nodSatisfied", 0.8);
  check(handTip("armR").x > 0.7 && handTip("armL").x < -0.7, "барьер: руки в боки");
  runTo("salute", 0.5);
  check(Vector3.Distance(handTip("armR"), new Vector3(0, 1.8, 0.33)) < 0.4, "барьер: козырнул");

  runTo("holdUp", 0.9);
  check(handTip("armR").y > 1.6 && handTip("armL").y > 1.6 && handTip("armR").z > 0.4, "находка: поднял обеими руками перед собой");
  runTo("hugTreasure", 1.0);
  check(Vector3.Distance(handTip("armR"), CHEST) < 0.4 && Vector3.Distance(handTip("armL"), CHEST) < 0.4, "находка: обнял");
  check(flips("hugTreasure", "torsoRoll", 2.0) >= 2, "находка: качается от радости");
  runTo("amazed", 0.9);
  check(handTip("armR").x > 0.9 && handTip("armL").x < -0.9, "находка: «ого!» — руки в стороны");
  check(flips("amazed", "headYaw", 1.9) >= 2, "находка: качает головой от изумления");

  runTo("challengePoint", 0.6);
  check(handTip("armR").z > 0.6 && handTip("armR").y > 1.1, "вызов: показывает на противника");
  runTo("challengeKnuckles", 0.7);
  check(Math.abs(handTip("armR").x - handTip("armL").x) < 0.5 && handTip("armR").z > 0.4, "вызов: ладони сомкнуты перед собой");
  check(peak("challengeStomp", 0.6, () => an.pose.legRPitch, "min") < -0.5, "вызов: топнул ногой");
}

// ---------------------------------------------------------------------------
// D4. Взгляд: голова поворачивается к цели, не мешая жестам
// ---------------------------------------------------------------------------
{
  settle();
  check(an.lookWeight === 0, "взгляд: по умолчанию выключен");
  an.look(0.8, 0.1, 1);
  for (let i = 0; i < 90; i++) an.update(DT, STAND);
  check(Math.abs(an.pose.headYaw - 0.8) < 0.05 && Math.abs(an.pose.headPitch - 0.1) < 0.05, `взгляд: голова повёрнута к цели (${an.pose.headYaw.toFixed(2)} рад)`);
  check(an.pose.torsoYaw > 0.15 && an.pose.torsoYaw < 0.25, "взгляд: плечи доворачиваются на четверть угла");
  an.look(-0.5, 0, 0.5);
  for (let i = 0; i < 90; i++) an.update(DT, STAND);
  check(Math.abs(an.pose.headYaw - -0.25) < 0.05, "взгляд: слабая сила — вполсилы");
  an.look(5, 3, 1);
  for (let i = 0; i < 120; i++) an.update(DT, STAND);
  check(an.pose.headYaw <= 1.001 && an.pose.headYaw > 0.95 && an.pose.headPitch <= 0.501, "взгляд: поворот головы ограничен (≈ 57°, шею не свернуть)");
  an.clearLook();
  const first = an.pose.headYaw;
  an.update(DT, STAND);
  check(Math.abs(an.pose.headYaw - first) < 0.1, "взгляд: голова отпускает цель плавно, без рывка");
  for (let i = 0; i < 120; i++) an.update(DT, STAND);
  check(an.lookWeight === 0 && Math.abs(an.pose.headYaw) < 1e-6 && Math.abs(an.pose.torsoYaw) < 1e-6, "взгляд: через пару секунд голова снова прямо");

  // Плавность: резкая смена цели не рвёт голову.
  an.look(-0.9, 0, 1);
  for (let i = 0; i < 90; i++) an.update(DT, STAND);
  an.look(0.9, 0, 1);
  let prev = an.pose.headYaw;
  let worst = 0;
  for (let i = 0; i < 90; i++) {
    an.update(DT, STAND);
    worst = Math.max(worst, Math.abs(an.pose.headYaw - prev));
    prev = an.pose.headYaw;
  }
  check(worst < 0.25, `взгляд: смена цели плавная, не рывком (макс. сдвиг за кадр ${worst.toFixed(3)} рад при развороте на 1.8)`);
  an.clearLook();

  // Жесты, которые сами ведут голову, важнее взгляда; остальные взгляду не мешают.
  settle();
  an.look(1, 0, 1);
  for (let i = 0; i < 90; i++) an.update(DT, STAND);
  an.play("lookAround");
  for (let i = 0; i < 60; i++) an.update(DT, STAND);
  check(Math.abs(an.pose.headYaw) < 1.3 && an.pose.headYaw < 1.0 + 0.3, `взгляд уступает жесту «огляделся» (голова ${an.pose.headYaw.toFixed(2)}, а не сумма двух поворотов)`);
  settle();
  an.look(0.8, 0, 1);
  an.play("shuffleDance");
  for (let i = 0; i < 90; i++) an.update(DT, STAND);
  check(an.pose.headYaw > 0.6, "жест без собственных поворотов головы (танец) взгляду не мешает");
  an.clearLook();
  settle();
  an.look(0.7, 0, 1);
  for (let i = 0; i < 60; i++) an.update(DT, STAND);
  settle();
  check(an.lookWeight === 0 && Math.abs(an.pose.headYaw) < 1e-9, "сброс аниматора снимает и взгляд");

  // Взгляд на бегу: голова повёрнута, ноги шагают, ноги и тело не трогаются.
  settle();
  an.look(0.6, 0, 1);
  let legMax = 0;
  for (let i = 0; i < 120; i++) {
    an.update(DT, RUN);
    legMax = Math.max(legMax, Math.abs(an.pose.legLPitch));
  }
  check(legMax > 0.4 && an.pose.headYaw > 0.45, "взгляд на бегу: смотрит вбок и продолжает бежать");
  an.clearLook();
}

// ---------------------------------------------------------------------------
// E. Поведение жестов
// ---------------------------------------------------------------------------
{
  // Мягкий жест обрывается шагом.
  settle();
  an.play("scratchHead");
  for (let i = 0; i < 30; i++) an.update(DT, STAND);
  check(an.currentGesture === "scratchHead", "почесывание идёт, пока игрок стоит");
  for (let i = 0; i < 30; i++) an.update(DT, RUN);
  check(an.currentGesture === null && !an.isBusy, "первый шаг обрывает почесывание, и оно плавно уходит");

  // Клавиша, зажатая в стену, — не шаг: упёршийся в стену дочёсывает голову.
  settle();
  an.play("scratchHead");
  for (let i = 0; i < 90; i++) an.update(DT, PUSH);
  check(an.currentGesture === "scratchHead", "зажатая в стену клавиша не обрывает почёсывание (хода нет)");
  for (let i = 0; i < 30; i++) an.update(DT, { speed: 2, intent: true, progress: 0.5 });
  check(an.currentGesture === null, "а скольжение вдоль стены — уже ход, и жест уступает");

  // Жест, у которого нет cancelOnMove, шагом не обрывается.
  settle();
  an.play("burnHopA");
  for (let i = 0; i < 40; i++) an.update(DT, RUN);
  check(an.currentGesture === "burnHopA", "прыжок на костре шагом не обрывается");

  // Победа обрывается шагом, но не раньше чем через ~0.9 с.
  settle();
  an.play("victorySpin");
  for (let i = 0; i < 30; i++) an.update(DT, RUN);
  check(an.currentGesture === "victorySpin", "победный жест в первые ~0.9 с шагом не обрывается");
  for (let i = 0; i < 40; i++) an.update(DT, RUN);
  check(an.currentGesture === null, "позже победный жест уступает шагу");

  // Приоритеты.
  settle();
  check(an.play("castRight"), "каст запускается");
  check(an.play("scratchHead") === false && an.currentGesture === "castRight", "почёсывание не перебивает каст");
  check(an.play("bonk") === false, "реакция мира не перебивает каст");
  check(an.play("scratchHead", true) && an.currentGesture === "scratchHead", "force вытесняет в любом случае");
  settle();
  an.play("scratchHead");
  check(an.play("bonk") && an.currentGesture === "bonk", "более важный жест вытесняет менее важный");
  for (let i = 0; i < 3; i++) an.update(DT, STAND);
  check(an.isBusy, "вытесненный жест ещё доигрывается (плавный переход)");
  settle();
  an.play("castRight");
  for (let i = 0; i < Math.ceil((GESTURES.castRight.duration + 0.1) / DT); i++) an.update(DT, STAND);
  check(an.play("scratchHead"), "после конца жеста снова можно запускать «скучающие»");

  // Случайный выбор.
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const picker = new PlayerAnimator(buildPlayerRig(scene, scene.getTransformNodeByName("playerVisual")!), rnd);
  const seen = new Set<GestureId>();
  let repeats = 0;
  let last: GestureId | null = null;
  for (let i = 0; i < 300; i++) {
    const id = picker.playOneOf(VICTORY_GESTURES, "victory");
    if (id) {
      seen.add(id);
      if (id === last) repeats++;
      last = id;
    }
    for (let k = 0; k < Math.ceil(3 / DT); k += 20) picker.update(DT * 20, STAND);
  }
  check(repeats === 0, "случайный выбор не повторяет один и тот же жест подряд");
  check(seen.size === VICTORY_GESTURES.length, `за 300 побед встретились все ${VICTORY_GESTURES.length} вариантов`);
  check(picker.playOneOf([], "empty") === null, "пустой набор — ничего не играет");
  const single = new PlayerAnimator(buildPlayerRig(scene, scene.getTransformNodeByName("playerVisual")!), () => 0.999999);
  check(single.playOneOf(["wave"], "one") === "wave", "набор из одного жеста играет его (граница random = 0.999…)");
}

// ---------------------------------------------------------------------------
// F. Удерживаемые позы
// ---------------------------------------------------------------------------
{
  settle();
  an.setHeld("sit");
  for (let i = 0; i < 90; i++) an.update(DT, STAND);
  check(an.heldPose === "sit" && near(an.pose.legLPitch, HELD_POSES.sit.values.legLPitch!, 0.01), "сел: ноги вытянуты вперёд");
  check(an.pose.bodyY < -0.4, "сел: тело на земле");
  check(near(lowestPoint(), 0, 0.03), "сидя, персонаж касается земли");
  an.setHeld(null);
  for (let i = 0; i < 90; i++) an.update(DT, STAND);
  check(an.heldPose === null && near(an.pose.legLPitch, 0, 0.01) && near(an.pose.bodyY, 0, 0.01), "встал: поза плавно снята");

  // Боевая стойка и жест поверх неё: после жеста возвращается стойка.
  settle();
  an.setHeld("battleStance");
  for (let i = 0; i < 60; i++) an.update(DT, STAND);
  const stanceLeg = an.pose.legLPitch;
  check(near(stanceLeg, HELD_POSES.battleStance.values.legLPitch!, 0.02), "боевая стойка: ноги расставлены");
  an.play("castBoth");
  for (let i = 0; i < Math.ceil((GESTURES.castBoth.duration + 0.5) / DT); i++) an.update(DT, STAND);
  check(near(an.pose.legLPitch, stanceLeg, 0.02) && near(an.pose.armRPitch, HELD_POSES.battleStance.values.armRPitch!, 0.02), "после каста персонаж возвращается в боевую стойку");
  an.setHeld(null);
  for (let i = 0; i < 90; i++) an.update(DT, STAND);

  // Смена одной удерживаемой позы на другую — плавная.
  settle();
  an.setHeld("sit");
  for (let i = 0; i < 90; i++) an.update(DT, STAND);
  an.setHeld("battleStance");
  let maxJump = 0;
  let prevLeg = an.pose.legLPitch;
  for (let i = 0; i < 90; i++) {
    an.update(DT, STAND);
    maxJump = Math.max(maxJump, Math.abs(an.pose.legLPitch - prevLeg));
    prevLeg = an.pose.legLPitch;
  }
  check(maxJump < 0.15, `переход сидя → стойка плавный (макс. скачок ноги за кадр ${maxJump.toFixed(3)})`);
  an.setHeld(null);

  // Крадётся: ссутулился, но ходьба продолжается.
  settle();
  an.setHeld("sneak");
  let legMax = 0;
  for (let i = 0; i < 120; i++) {
    an.update(DT, RUN);
    legMax = Math.max(legMax, Math.abs(an.pose.legLPitch));
  }
  check(legMax > 0.4 && an.pose.torsoPitch > 0.3, "крадётся: торс подан вперёд, а ноги всё равно шагают");
  an.setHeld(null);
}

// ---------------------------------------------------------------------------
// G. PlayerController: движение, стена, блокировка
// ---------------------------------------------------------------------------
{
  const floor = MeshBuilder.CreateBox("testFloor", { width: 40, height: 1, depth: 40 }, scene);
  floor.position.y = -0.5;
  floor.checkCollisions = true;
  const wall = MeshBuilder.CreateBox("testWall", { width: 20, height: 4, depth: 1 }, scene);
  wall.position.set(0, 2, 8);
  wall.checkCollisions = true;
  // Без рендера (NullEngine) мировые матрицы статичных мешей не обновляются сами — в игре это делает scene.render().
  floor.computeWorldMatrix(true);
  wall.computeWorldMatrix(true);

  // Коллайдер первого игрока стоит в начале координат: убираем, чтобы не мешал второму.
  player.collider.checkCollisions = false;

  const keys = new Set<string>();
  const pc = new PlayerController(scene, new Vector3(0, 0.05, 0), { isDown: (a) => keys.has(a) });
  const forward = new Vector3(0, 0, 1);
  const right = new Vector3(1, 0, 0);
  const step = (n: number): void => {
    for (let i = 0; i < n; i++) {
      pc.collider.computeWorldMatrix(true);
      pc.update(DT, forward, right);
    }
  };

  step(30);
  check(!pc.motion.intent && pc.motion.speed < 0.05, "стоит: намерения нет, скорость нулевая");
  keys.add("moveForward");
  step(30);
  check(pc.motion.intent && near(pc.motion.speed, 6.5, 0.4) && pc.motion.progress > 0.9, `идёт: скорость ≈ 6.5 м/с, прогресс ≈ 1 (${pc.motion.speed.toFixed(2)}, ${pc.motion.progress.toFixed(2)})`);
  check(pc.animator.walkAmount > 0.5, "идёт: аниматор включил походку");

  // Упёрся в стену лбом.
  step(120);
  check(pc.position.z < 7.2, `стена остановила игрока (z = ${pc.position.z.toFixed(2)})`);
  check(pc.motion.intent && pc.motion.progress < 0.15 && pc.motion.speed < 1, `лбом в стену: намерение есть, а прогресс ≈ 0 (${pc.motion.progress.toFixed(2)})`);
  step(30);
  check(pc.animator.walkAmount < 0.2, "лбом в стену: ноги не бегут на месте");

  // Скользит вдоль стены под острым углом: прогресс заметно выше, чем при лобовом.
  keys.add("moveRight");
  step(30);
  const diag = pc.motion.progress;
  check(pc.motion.intent && diag > 0.3 && diag < 0.9, `под углом 45° скользит вдоль стены: прогресс между «упёрся» и «свободно» (${diag.toFixed(2)})`);
  keys.clear();

  // Блокировка ввода: намерение пропадает, как и скорость.
  keys.add("moveBack");
  step(10);
  pc.inputLocked = true;
  step(30);
  check(!pc.motion.intent && pc.motion.speed < 0.05 && pc.animator.walkAmount < 0.1, "ввод заблокирован (бой, меню): ни намерения, ни ходьбы");
  keys.clear();

  // Рюкзак едет с телом: наклон торса сдвигает его.
  pc.inputLocked = false;
  step(30);
  pc.backMount.node.computeWorldMatrix(true);
  const before = pc.backMount.node.getAbsolutePosition().clone();
  pc.animator.play("castOverhead");
  let moved = 0;
  for (let i = 0; i < 40; i++) {
    step(1);
    pc.backMount.node.computeWorldMatrix(true);
    moved = Math.max(moved, Vector3.Distance(pc.backMount.node.getAbsolutePosition(), before));
  }
  check(moved > 0.05, `рюкзак двигается вместе с торсом при жесте (сдвиг до ${moved.toFixed(2)} м)`);

  // Визуал и коллайдер: анимация не двигает коллайдер.
  const at = pc.position.clone();
  pc.animator.play("burnHopA");
  step(40);
  check(near(pc.position.x, at.x, 1e-3) && near(pc.position.z, at.z, 1e-3) && near(pc.position.y, at.y, 0.05), "прыжок на костре — только визуальный: коллайдер стоит на месте");
  pc.collider.dispose();
}

engine.dispose();
console.log(failures === 0 ? `OK: оживление персонажа — ${checks} проверок (шарниры, походка, ${GESTURE_IDS.length} жестов, позы, коллизии)` : `ПРОВАЛОВ: ${failures} из ${checks}`);
process.exit(failures === 0 ? 0 : 1);
