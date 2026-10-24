// 3D-сцена боя без браузера (NullEngine + happy-dom):
//  A. Геометрия ракурсов: камера «за спиной», ракурс удара, кратчайший поворот, конечные точки (сверка с настоящей ArcRotateCamera).
//  B. CameraDirector: переходы, ограничения камеры, снятие/возврат мыши, нет зависших промисов.
//  C. Вид анимации по школе (камень/пар/луч/молния/сфера) и запасной вариант.
//  D. StrikeFx: каждый вид эффекта — урон ровно один раз, ленивое создание, вспышка, отмена, чистая выгрузка.
//  E. BabylonBattleStage: разворот бойцов, ракурс на ударе, возврат за спину, обрыв боя, ограничение кадра.
//  F. Крючки противников и разворот ведьмы/игрока.
//  G. Сквозной бой: настоящие CombatManager + Witch + PlayerController + сцена.
// Запуск: npm run test:battle-stage.
import { Window } from "happy-dom";
import { ArcRotateCamera, NullEngine, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { CombatManager } from "../src/combat/CombatManager";
import { createOpponentFactory } from "../src/combat/opponent";
import type { BattleOpponent, BattleOutcome } from "../src/combat/opponent";
import { PowerPool } from "../src/combat/PowerPool";
import { SpellFatigue } from "../src/combat/SpellFatigue";
import { PLAYER_MAX_POWER, TRAINING_WITCH_POWER, WITCH_HIT_DAMAGE } from "../src/combat/combatBalance";
import { CameraDirector } from "../src/combat/stage/CameraDirector";
import type { CameraRig } from "../src/combat/stage/CameraDirector";
import { BabylonBattleStage, STAGE_TIMING } from "../src/combat/stage/BabylonBattleStage";
import type { StagePlayer } from "../src/combat/stage/BabylonBattleStage";
import { StrikeFx } from "../src/combat/stage/StrikeFx";
import {
  REST_BETA,
  REST_RADIUS_MAX,
  REST_RADIUS_MIN,
  SHOT_BACK_BIAS,
  SHOULDER_OFFSET,
  angleDelta,
  behindPlayerPose,
  lerpPose,
  strikeEndPoint,
  strikeShotPose,
  yawToward,
} from "../src/combat/stage/stagePoses";
import type { CameraPose } from "../src/combat/stage/stagePoses";
import { strikeKindFor } from "../src/combat/stage/strikeKinds";
import { EFFECT_FACTORIES } from "../src/combat/stage/strikeRecipes";
import type { StrikeKind } from "../src/combat/stage/strikeRecipes";
import { GameState } from "../src/core/GameState";
import { PlayerController } from "../src/core/PlayerController";
import { ALL_SCHOOLS, ALL_SPELLS, getSpellById } from "../src/data/spells";
import { Witch } from "../src/entities/Witch";
import { Color3 } from "@babylonjs/core";

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
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

const DT = 1 / 60;
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Крутит кадры, пока условие не выполнится (или не истечёт лимит симулируемого времени). Возвращает симулированные секунды. */
async function pump(update: (dt: number) => void, done: () => boolean, maxSeconds = 12): Promise<number> {
  let t = 0;
  while (!done() && t < maxSeconds) {
    update(DT);
    t += DT;
    await tick();
  }
  return t;
}

/** Расстояние от точки до ближайшей точки габаритного бокса меша: верно и для луча (его центр — на полпути, а конец — у цели). */
function distanceToMesh(m: { computeWorldMatrix(force?: boolean): unknown; getBoundingInfo(): { boundingBox: { minimumWorld: Vector3; maximumWorld: Vector3 } } }, p: Vector3): number {
  m.computeWorldMatrix(true);
  const { minimumWorld: lo, maximumWorld: hi } = m.getBoundingInfo().boundingBox;
  const cx = Math.max(lo.x, Math.min(hi.x, p.x));
  const cy = Math.max(lo.y, Math.min(hi.y, p.y));
  const cz = Math.max(lo.z, Math.min(hi.z, p.z));
  return Math.hypot(p.x - cx, p.y - cy, p.z - cz);
}

/** Позиция камеры по формуле ArcRotateCamera (для сверки с настоящей). */
function cameraPosition(pose: CameraPose): { x: number; y: number; z: number } {
  const sb = Math.sin(pose.beta);
  return {
    x: pose.target.x + pose.radius * Math.cos(pose.alpha) * sb,
    y: pose.target.y + pose.radius * Math.cos(pose.beta),
    z: pose.target.z + pose.radius * Math.sin(pose.alpha) * sb,
  };
}

const flash = (scene: Scene): boolean => scene.meshes.some((m) => m.name === "fx_flash" && m.isEnabled());
const enabledFx = (scene: Scene): string[] => scene.meshes.filter((m) => m.name.startsWith("fx_") && m.isEnabled()).map((m) => m.name);

async function main(): Promise<void> {
  const engine = new NullEngine();

  // ---------------------------------------------------------------------------
  // A. Геометрия
  // ---------------------------------------------------------------------------
  {
    check(near(angleDelta(0, 1), 1) && near(angleDelta(1, 0), -1), "angleDelta: обычная разница");
    check(near(angleDelta(3, -3), 2 * Math.PI - 6), "angleDelta: через ±π идём кратчайшим путём");
    check(near(angleDelta(0, 2 * Math.PI), 0), "angleDelta: полный оборот — ноль");
    check(near(yawToward(0, 0, 0, 5), 0) && near(yawToward(0, 0, 5, 0), Math.PI / 2) && near(yawToward(0, 0, 0, -5), Math.PI), "yawToward: 0 = +Z, π/2 = +X");

    const player = { x: 3, y: 1, z: -2 };
    for (const yaw of [0, Math.PI / 2, Math.PI, -2, 3.5]) {
      const pose = behindPlayerPose(player, yaw, 7);
      const cam = cameraPosition(pose);
      const hx = cam.x - player.x;
      const hz = cam.z - player.z;
      const hlen = Math.hypot(hx, hz);
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const cosFromBack = (hx * -fx + hz * -fz) / hlen; // косинус угла между «камера→игрок» и «назад»
      check(near(Math.acos(Math.min(1, cosFromBack)), SHOULDER_OFFSET, 1e-6), `за спиной (yaw=${yaw}): камера отклонена от «строго назад» ровно на плечо`);
      check(hx * fx + hz * fz < 0, `за спиной (yaw=${yaw}): камера позади игрока, а не впереди`);
      check(pose.target.x === player.x && pose.target.z === player.z && pose.beta === REST_BETA, "цель камеры — сам игрок (бесшовный возврат к слежению)");
    }
    check(behindPlayerPose(player, 0, 1).radius === REST_RADIUS_MIN && behindPlayerPose(player, 0, 99).radius === REST_RADIUS_MAX && behindPlayerPose(player, 0, 6.5).radius === 6.5, "дистанция за спиной зажата в границы");

    // Формула совпадает с настоящей ArcRotateCamera (иначе «за спиной» оказалось бы где-то ещё).
    {
      const scene = new Scene(engine);
      const cam = new ArcRotateCamera("c", 0, 1, 5, Vector3.Zero(), scene);
      const pose = behindPlayerPose(player, 1.1, 6);
      cam.alpha = pose.alpha;
      cam.beta = pose.beta;
      cam.radius = pose.radius;
      cam.setTarget(new Vector3(pose.target.x, pose.target.y, pose.target.z), false, true, true);
      cam.getViewMatrix(true);
      const expected = cameraPosition(pose);
      check(near(cam.position.x, expected.x, 1e-4) && near(cam.position.y, expected.y, 1e-4) && near(cam.position.z, expected.z, 1e-4), "позиция настоящей ArcRotateCamera совпадает с формулой поз");
      scene.dispose();
    }

    // Ракурс удара.
    const A = { x: 0, y: 1, z: 0 };
    const B = { x: 4, y: 1.3, z: 0 };
    for (const [alpha, sign] of [[Math.PI / 2, 1], [-Math.PI / 2, -1]] as const) {
      const pose = strikeShotPose(A, B, alpha);
      const cam = cameraPosition(pose);
      const hx = cam.x - pose.target.x;
      const hz = cam.z - pose.target.z;
      const hlen = Math.hypot(hx, hz);
      check(Math.sign(hz) === sign, `ракурс удара: камера остаётся на своей стороне (alpha=${alpha.toFixed(2)})`);
      check(near((hx / hlen) * 1 + (hz / hlen) * 0, -Math.sin(SHOT_BACK_BIAS), 1e-6), "ракурс удара: сдвинут от боковой точки к спине бьющего");
      check(near(pose.target.x, 2) && near(pose.target.y, 1.15) && near(pose.target.z, 0), "ракурс удара: смотрим на середину линии удара");
    }
    const flipped = strikeShotPose(B, A, Math.PI / 2); // тот же бой, бьёт другой
    check(Math.sign(Math.sin(flipped.alpha)) === 1, "ракурс удара: при смене бьющего камера не облетает сцену на 180°");
    const degenerate = strikeShotPose(A, { ...A }, 0);
    check(Number.isFinite(degenerate.alpha) && Number.isFinite(degenerate.radius) && degenerate.radius >= 5, "ракурс удара: бьющий и цель в одной точке — без NaN");
    check(strikeShotPose(A, { x: 40, y: 1, z: 0 }, 0).radius <= 8.5, "дистанция на ударе ограничена сверху");

    const mid = lerpPose({ alpha: 3, beta: 1, radius: 4, target: { x: 0, y: 0, z: 0 } }, { alpha: -3, beta: 2, radius: 6, target: { x: 2, y: 2, z: 2 } }, 0.5, { alpha: 0, beta: 0, radius: 0, target: { x: 0, y: 0, z: 0 } });
    check(near(Math.cos(mid.alpha), -1, 1e-3) && near(mid.beta, 1.5) && near(mid.radius, 5) && near(mid.target.x, 1), "lerpPose: угол идёт кратчайшим путём через π, остальное — линейно");

    const from = { x: 0, y: 1, z: 0 };
    const to = { x: 4, y: 1, z: 0 };
    const hit = strikeEndPoint(from, to, "hit");
    const blocked = strikeEndPoint(from, to, "blocked");
    const missed = strikeEndPoint(from, to, "missed");
    check(hit.x === 4 && hit.y === 1, "попадание: заклинание летит в цель");
    check(blocked.x > 2 && blocked.x < 4, "отражение: заклинание не долетает до цели");
    check(Math.hypot(missed.x - to.x, missed.z - to.z) > 1 && missed.y > to.y, "мимо: пролетает сбоку и выше цели");
  }

  // ---------------------------------------------------------------------------
  // B. CameraDirector
  // ---------------------------------------------------------------------------
  {
    interface FakeV { x: number; y: number; z: number }
    const targetSeen: FakeV[] = [];
    let setTargetArgs: boolean[] = [];
    const rig: CameraRig<FakeV> & { alpha: number; beta: number; radius: number } = {
      alpha: 0,
      beta: 1,
      radius: 8,
      lowerBetaLimit: 0.5,
      upperBetaLimit: 1.49,
      lowerRadiusLimit: 4,
      upperRadiusLimit: 14,
      inertialAlphaOffset: 0.3,
      inertialBetaOffset: 0.2,
      inertialRadiusOffset: 0.1,
      getTarget: () => ({ x: 0, y: 0, z: 0 }),
      setTarget(t, toCenter, same, clone) {
        targetSeen.push(t);
        setTargetArgs = [Boolean(toCenter), Boolean(same), Boolean(clone)];
        (rig as unknown as { _t: FakeV })._t = { ...t };
      },
    };
    rig.getTarget = () => (rig as unknown as { _t?: FakeV })._t ?? { x: 0, y: 0, z: 0 };
    let detached = 0;
    let attached = 0;
    const director = new CameraDirector<FakeV>(rig, { detach: () => detached++, attach: () => attached++ }, { x: 0, y: 0, z: 0 });
    const goal: CameraPose = { alpha: 1, beta: 1.2, radius: 6, target: { x: 2, y: 1, z: 3 } };

    let resolved = false;
    void director.glideTo(goal, 0.5).then(() => (resolved = true));
    await tick();
    check(resolved, "вне режима режиссёра glideTo завершается сразу и ничего не двигает");
    check(!director.isDirecting && rig.alpha === 0, "камера не тронута, пока режиссёр не принял управление");

    director.takeOver();
    director.takeOver();
    check(director.isDirecting && detached === 1, "takeOver отключает мышь один раз");
    check(rig.inertialAlphaOffset === 0 && rig.inertialBetaOffset === 0 && rig.inertialRadiusOffset === 0, "остаточное вращение мышью погашено");

    resolved = false;
    void director.glideTo(goal, 0.5).then(() => (resolved = true));
    director.update(0.25);
    await tick();
    check(!resolved && rig.alpha > 0 && rig.alpha < 1, "на полпути переход не завершён, угол между старым и новым");
    const frames = await pump((dt) => director.update(dt), () => resolved, 2);
    check(resolved && frames < 0.5, "переход завершается за заданное время");
    check(near(rig.alpha, 1) && near(rig.beta, 1.2) && near(rig.radius, 6), "итоговая поза точная");
    check(rig.getTarget().x === 2 && rig.getTarget().z === 3, "цель камеры точная");
    check(setTargetArgs[2] === true && setTargetArgs[1] === true, "setTarget зовётся с cloneAlphaBetaRadius=true (иначе Babylon пересчитал бы углы)");
    check(new Set(targetSeen).size === 1, "каждый кадр переиспользуется один и тот же вектор (без мусора)");

    void director.glideTo({ alpha: 0, beta: 0.1, radius: 99, target: { x: 0, y: 0, z: 0 } }, 0);
    director.update(DT);
    check(rig.beta === 0.5 && rig.radius === 14, "поза зажимается в ограничения камеры (наклон и дистанция)");

    // Новый переход заменяет прежний, оба промиса завершаются.
    let firstDone = false;
    let secondDone = false;
    void director.glideTo(goal, 5).then(() => (firstDone = true));
    void director.glideTo({ ...goal, alpha: 2 }, 0.1).then(() => (secondDone = true));
    await tick();
    check(firstDone && !secondDone, "новый переход завершает прежний на месте");
    await pump((dt) => director.update(dt), () => secondDone, 1);
    check(secondDone, "новый переход доходит до конца");

    // Обрыв: release не оставляет висящих промисов и возвращает мышь.
    let pendingDone = false;
    void director.glideTo(goal, 10).then(() => (pendingDone = true));
    director.release();
    director.release();
    await tick();
    check(pendingDone && !director.isDirecting && attached === 1, "release завершает незаконченный переход, возвращает мышь (один раз)");
    const alphaAfterRelease = rig.alpha;
    director.update(DT); // после release кадры камеру не двигают
    check(rig.alpha === alphaAfterRelease, "после release update камеру не трогает");

    let holdDone = false;
    director.takeOver();
    void director.hold(0.2).then(() => (holdDone = true));
    const before = rig.alpha;
    await pump((dt) => director.update(dt), () => holdDone, 1);
    check(holdDone && near(rig.alpha, before), "hold стоит на месте указанное время");
    director.release();
  }

  // ---------------------------------------------------------------------------
  // C. Вид анимации по школе
  // ---------------------------------------------------------------------------
  {
    const expected: Record<string, StrikeKind> = { earth: "stone", fire: "steam", light: "beam", storm: "lightning", secrets: "orb" };
    for (const school of ALL_SCHOOLS) {
      check(expected[school.id] !== undefined, `для школы «${school.id}» в тесте задан ожидаемый образ (добавь, если появилась новая)`);
      check(strikeKindFor({ id: "x", school: school.id }) === expected[school.id], `школа «${school.id}» → ${expected[school.id]}`);
    }
    check(strikeKindFor({ id: "x", school: "unknown-school" }) === "orb", "неизвестная школа — запасная сфера");
    for (const spell of ALL_SPELLS) {
      check(EFFECT_FACTORIES[strikeKindFor(spell)] !== undefined, `у заклинания «${spell.id}» есть фабрика анимации`);
    }
    check(strikeKindFor(getSpellById("velocity")) === "stone" && strikeKindFor(getSpellById("spark")) === "steam", "механика бросает камень, термодинамика пускает пар");
    check(Object.keys(EFFECT_FACTORIES).sort().join() === "beam,lightning,orb,steam,stone", "все пять видов эффектов на месте");
  }

  // ---------------------------------------------------------------------------
  // D. StrikeFx
  // ---------------------------------------------------------------------------
  {
    const KINDS: StrikeKind[] = ["stone", "steam", "beam", "lightning", "orb"];
    const scene = new Scene(engine);
    const baseline = scene.meshes.length;
    const fx = new StrikeFx(scene);
    check(fx.createdKinds.length === 0 && scene.meshes.length === baseline, "до первого удара ни одного эффекта не создано (лениво)");

    for (const kind of KINDS) {
      const from = new Vector3(0, 1.1, 0);
      const to = new Vector3(0, 1.3, 4);
      let impacts = 0;
      let impactAtFrames = -1;
      let frame = 0;
      let done = false;
      let sawEffect = false;
      let nearestToTarget = Infinity; // у эффекта из нескольких мешей (молния, пар) смотрим на ближайший к цели в последнем видимом кадре
      void fx
        .play({ kind, from, to, color: Color3.FromHexString("#ff6b3d"), result: "hit", startDelay: 0.1, onImpact: () => { impacts++; impactAtFrames = frame; } })
        .then(() => (done = true));
      const seconds = await pump(
        (dt) => {
          frame++;
          fx.update(dt);
          const live = scene.meshes.filter((m) => m.name.startsWith("fx_") && m.name !== "fx_flash" && m.isEnabled() && m.visibility > 0);
          if (live.length > 0) {
            sawEffect = true;
            nearestToTarget = Math.min(...live.map((m) => distanceToMesh(m, to)));
          }
        },
        () => done,
        6
      );
      check(done && seconds < 2.5, `${kind}: удар проигрывается и завершается (${seconds.toFixed(2)} с)`);
      check(impacts === 1, `${kind}: попадание сообщено ровно один раз`);
      check(impactAtFrames > 0 && impactAtFrames * DT >= 0.1, `${kind}: попадание не раньше конца замаха`);
      check(sawEffect, `${kind}: во время полёта есть видимые меши`);
      check(enabledFx(scene).length === 0, `${kind}: после удара ничего не рисуется (${enabledFx(scene).join(",")})`);
      check(nearestToTarget < 0.8, `${kind}: к концу полёта эффект добирается до цели (до ближайшего меша ${nearestToTarget.toFixed(2)} м)`);
    }
    check(fx.createdKinds.length === 5, "все пять эффектов созданы по первому использованию");
    const total = scene.meshes.length - baseline;
    check(total <= 25, `весь набор эффектов — ${total} мешей (лёгкий)`);
    check(scene.meshes.filter((m) => m.name.startsWith("fx_")).every((m) => !m.isPickable), "эффекты не перехватывают лучи (не pickable)");

    // Вспышка: попадание и щит — да, мимо — нет.
    for (const [result, expectFlash] of [["hit", true], ["blocked", true], ["missed", false]] as const) {
      let sawFlash = false;
      let impacts = 0;
      let done = false;
      void fx.play({ kind: "orb", from: new Vector3(0, 1, 0), to: new Vector3(0, 1, 3), color: Color3.White(), result, onImpact: () => impacts++ }).then(() => (done = true));
      await pump((dt) => { fx.update(dt); if (flash(scene)) sawFlash = true; }, () => done, 6);
      check(sawFlash === expectFlash, `вспышка при результате «${result}»: ${expectFlash ? "есть" : "нет"}`);
      check(impacts === 1, `результат «${result}»: onImpact вызван один раз`);
      check(!flash(scene), `результат «${result}»: вспышка погашена`);
    }

    // Отмена на лету: промис завершается, меши гаснут.
    {
      let done = false;
      void fx.play({ kind: "steam", from: new Vector3(0, 1, 0), to: new Vector3(0, 1, 5), color: Color3.White(), result: "hit" }).then(() => (done = true));
      for (let i = 0; i < 20; i++) fx.update(DT);
      check(enabledFx(scene).length > 0 && fx.isPlaying, "середина полёта: эффект виден");
      fx.cancel();
      await tick();
      check(done && !fx.isPlaying && enabledFx(scene).length === 0, "cancel завершает промис и гасит меши");
    }
    // Новый удар прерывает прежний.
    {
      let first = false;
      let second = false;
      void fx.play({ kind: "stone", from: new Vector3(0, 1, 0), to: new Vector3(0, 1, 5), color: Color3.White(), result: "hit" }).then(() => (first = true));
      for (let i = 0; i < 10; i++) fx.update(DT);
      void fx.play({ kind: "beam", from: new Vector3(0, 1, 0), to: new Vector3(0, 1, 5), color: Color3.White(), result: "hit" }).then(() => (second = true));
      await tick();
      check(first && !second, "второй удар обрывает первый");
      await pump((dt) => fx.update(dt), () => second, 6);
      check(second && enabledFx(scene).length === 0, "второй удар доигрывается");
    }
    // Падение onImpact не ломает показ.
    {
      let done = false;
      void fx.play({ kind: "orb", from: new Vector3(0, 1, 0), to: new Vector3(0, 1, 2), color: Color3.White(), result: "hit", onImpact: () => { throw new Error("boom"); } }).then(() => (done = true));
      const origWarn = console.warn;
      console.warn = () => {};
      await pump((dt) => fx.update(dt), () => done, 6);
      console.warn = origWarn;
      check(done, "исключение в onImpact не обрывает анимацию");
    }
    check(!fx.isPlaying, "в простое проигрыватель ничего не держит");
    fx.update(DT); // в простое update безопасен
    fx.dispose();
    check(scene.meshes.length === baseline, "dispose убирает из сцены все меши эффектов");
    scene.dispose();
  }

  // ---------------------------------------------------------------------------
  // E. BabylonBattleStage
  // ---------------------------------------------------------------------------
  const earthSpell = getSpellById("velocity");
  const fireSpell = getSpellById("spark");

  function makeStageEnv(yaw = 0.3) {
    const scene = new Scene(engine);
    const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.6, 9, new Vector3(0, 1, 0), scene);
    camera.lowerBetaLimit = 0.5;
    camera.upperBetaLimit = Math.PI / 2.1;
    camera.lowerRadiusLimit = 4;
    camera.upperRadiusLimit = 14;
    const player: StagePlayer & { facingYaw: number } = {
      position: new Vector3(0, 1, 0),
      facingYaw: yaw,
      faceToward(x: number, z: number) {
        this.facingYaw = Math.atan2(x - this.position.x, z - this.position.z);
      },
    };
    const input = { attached: 0, detached: 0 };
    const events: string[] = [];
    const anchor = new TransformNode("opp", scene);
    anchor.position.set(0, 0, 2);
    const opponent = {
      kind: "target",
      id: "o1",
      anchor,
      aimHeight: 1.3,
      playCast: () => events.push("cast"),
    } as unknown as BattleOpponent;
    const stage = new BabylonBattleStage({ scene, camera, player, input: { attach: () => input.attached++, detach: () => input.detached++ } });
    return { scene, camera, player, input, events, anchor, opponent, stage };
  }
  const settle = async (env: ReturnType<typeof makeStageEnv>) => { await pump((dt) => env.stage.update(dt), () => false, STAGE_TIMING.beginGlide + 0.1); };

  {
    const env = makeStageEnv();
    check(!env.stage.controlsCamera, "до боя камера принадлежит игроку");
    env.stage.begin(env.opponent);
    check(env.stage.controlsCamera && env.input.detached === 1, "в бою камерой управляет сцена, мышь отключена");
    check(near(env.player.facingYaw, 0), "игрок развернулся лицом к противнику (+Z)");
    check(near(Math.cos(env.anchor.rotation.y), -1, 1e-6), "противник без собственного поворота — anchor развёрнут лицом к игроку");
    await settle(env);

    env.camera.getViewMatrix(true);
    const pose = behindPlayerPose({ x: 0, y: 1, z: 0 }, 0, 9);
    check(near(env.camera.alpha, pose.alpha, 1e-6) && near(env.camera.radius, REST_RADIUS_MAX, 1e-6), "после начала боя камера стоит за спиной игрока");
    check(env.camera.position.z < env.player.position.z - 4, "камера физически позади игрока (противник впереди, по +Z)");

    // Удар игрока.
    const restAlpha = env.camera.alpha;
    let impactTarget: { x: number; y: number; z: number } | null = null;
    let impactAlpha = NaN;
    let impacts = 0;
    let done = false;
    void env.stage
      .strike({
        from: "player",
        spell: earthSpell,
        result: "hit",
        onImpact: () => {
          impacts++;
          impactAlpha = env.camera.alpha;
          const t = env.camera.getTarget();
          impactTarget = { x: t.x, y: t.y, z: t.z };
        },
      })
      .then(() => (done = true));
    const seconds = await pump((dt) => env.stage.update(dt), () => done, 6);
    check(done && impacts === 1, "удар игрока показан, попадание сообщено один раз");
    const expectedShot = strikeShotPose({ x: 0, y: 1.15, z: 0 }, { x: 0, y: 1.3, z: 2 }, restAlpha);
    check(impactTarget !== null && near((impactTarget as { z: number }).z, 1, 1e-3) && near(impactAlpha, expectedShot.alpha, 1e-6), "на попадании камера стоит на ракурсе удара и смотрит на середину линии");
    check(near(env.camera.alpha, restAlpha, 1e-6) && near(env.camera.radius, REST_RADIUS_MAX, 1e-6), "после удара камера вернулась за спину игрока");
    check(seconds < 2.4, `удар занимает ${seconds.toFixed(2)} с — бой не затягивается`);
    check(env.events.length === 0, "у игрока нет замаха противника");
    check(enabledFx(env.scene).length === 0, "после удара эффекты погашены");

    // Удар противника: замах предшествует попаданию.
    const order: string[] = [];
    env.opponent.playCast = () => order.push("cast");
    done = false;
    void env.stage.strike({ from: "opponent", spell: fireSpell, result: "hit", onImpact: () => order.push("impact") }).then(() => (done = true));
    await pump((dt) => env.stage.update(dt), () => done, 6);
    check(order.join() === "cast,impact", "удар противника: сначала замах, потом попадание");

    // Отражённый и промах — без урона, но анимация доигрывается.
    for (const result of ["blocked", "missed"] as const) {
      done = false;
      let called = 0;
      void env.stage.strike({ from: "opponent", spell: earthSpell, result, onImpact: () => called++ }).then(() => (done = true));
      await pump((dt) => env.stage.update(dt), () => done, 6);
      check(done && called === 1, `результат «${result}» доигрывается, onImpact вызван один раз (что с ним делать — решает менеджер боя)`);
    }

    // Обрыв боя посреди удара.
    done = false;
    impacts = 0;
    void env.stage.strike({ from: "player", spell: earthSpell, result: "hit", onImpact: () => impacts++ }).then(() => (done = true));
    for (let i = 0; i < 12; i++) env.stage.update(DT);
    env.stage.end();
    await tick();
    await tick();
    check(done, "end() посреди удара не оставляет висящий промис");
    check(impacts === 1, "обрыв: попадание применено ровно один раз");
    check(!env.stage.controlsCamera && env.input.attached === 1, "камера и мышь возвращены игроку");
    check(enabledFx(env.scene).length === 0, "обрыв: эффекты погашены");

    // Удар вне боя: сразу применяется и ничего не рисует.
    let late = 0;
    await env.stage.strike({ from: "player", spell: earthSpell, result: "hit", onImpact: () => late++ });
    check(late === 1 && enabledFx(env.scene).length === 0, "удар вне боя применяется мгновенно, без анимации");

    env.stage.update(DT); // в простое безопасно
    env.stage.dispose();
    env.scene.dispose();
  }

  // Ограничение кадра: после лага/паузы вкладки анимация не «перематывается».
  {
    const env = makeStageEnv(1.5);
    env.stage.begin(env.opponent);
    env.stage.update(5);
    check(env.camera.radius > 8.5, "кадр длиннее 0.1 с зажимается: камера не перепрыгнула в конечную позу");
    env.stage.dispose();
    env.scene.dispose();
  }

  // ---------------------------------------------------------------------------
  // F. Крючки противников, разворот ведьмы и игрока
  // ---------------------------------------------------------------------------
  {
    const scene = new Scene(engine);
    scene.collisionsEnabled = true;
    const player = new PlayerController(scene, new Vector3(0, 1, 0), { isDown: () => false });
    check(near(player.facingYaw, 0), "новый игрок смотрит в +Z");
    player.faceToward(5, 0);
    check(near(player.facingYaw, Math.PI / 2), "faceToward(+X) → курс π/2");
    player.faceToward(0, -3);
    check(near(Math.abs(player.facingYaw), Math.PI), "faceToward(−Z) → курс π");

    const witch = new Witch(scene, new Vector3(0, 0, 0), earthSpell, "wf1", false);
    witch.faceToward(10, 0);
    check(near(witch.root.rotation.y, Math.PI / 2) && near(witch.facingYaw, Math.PI / 2), "ведьма развернулась, и курс запомнил мозг (не отскочит после боя)");

    const factory = createOpponentFactory(() => 90);
    const wo = factory.witch(witch);
    check(wo.aimHeight === 1.3, "ведьму целят в грудь");
    wo.faceToward?.(0, 10);
    check(near(witch.root.rotation.y, 0), "крючок faceToward разворачивает ведьму");
    let swung = 0;
    witch.swingStaff = () => { swung++; };
    wo.playCast?.();
    check(swung === 1, "крючок playCast — взмах посохом");

    const heights: Record<string, number> = { tree: 1.4, dummy: 1.25, nettle: 0.3 };
    for (const [kind, h] of Object.entries(heights)) {
      const t = factory.target({ id: `t-${kind}`, kind, root: new TransformNode(`t-${kind}`, scene) } as never);
      check(t.aimHeight === h && t.faceToward === undefined && t.playCast === undefined, `цель «${kind}»: высота ${h}, без особых крючков`);
    }
    scene.dispose();
  }

  // ---------------------------------------------------------------------------
  // G. Сквозной бой: CombatManager + настоящие Witch и PlayerController + сцена
  // ---------------------------------------------------------------------------
  {
    const win = new Window({ url: "http://localhost/" });
    const g = globalThis as unknown as Record<string, unknown>;
    g.window = win;
    g.document = win.document;
    const doc = win.document;
    doc.body.innerHTML = "";
    const rootEl = doc.createElement("div");
    doc.body.appendChild(rootEl);
    const root = rootEl as unknown as HTMLElement;

    const scene = new Scene(engine);
    scene.collisionsEnabled = true;
    const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.6, 9, new Vector3(0, 1, 0), scene);
    const player = new PlayerController(scene, new Vector3(0, 1, 0), { isDown: () => false });
    const witch = new Witch(scene, new Vector3(0, 0, 2), earthSpell, "w-e2e", false);
    // Ведьма заметила игрока (идёт к нему): по правилам первой бьёт она.
    (witch as unknown as { brain: { state: string } }).brain.state = "chase";
    let attached = 0;
    let detached = 0;
    let swings = 0;
    const origSwing = witch.swingStaff.bind(witch);
    witch.swingStaff = (cb) => { swings++; origSwing(cb); };
    const stage = new BabylonBattleStage({ scene, camera, player, input: { attach: () => attached++, detach: () => detached++ } });

    const gs = new GameState();
    gs.learn("spark");
    gs.learn("flame");
    const power = new PowerPool(PLAYER_MAX_POWER);
    const ended: BattleOutcome[] = [];
    const combat = new CombatManager(
      root,
      { gameState: gs, playerPower: power, fatigue: new SpellFatigue(), stage, timing: { feedbackOkMs: 0, feedbackFailMs: 0 }, random: () => 0 },
      { onBattleEnd: (_o, outcome) => ended.push(outcome) }
    );

    const frames = setInterval(() => stage.update(DT), 1);
    const text = (sel: string): string => (root.querySelector(sel)?.textContent ?? "").trim();
    const questionByText = new Map(ALL_SPELLS.flatMap((s) => s.questions.map((q) => [q.text, q] as const)));
    const until = async (pred: () => boolean, what: string): Promise<boolean> => {
      for (let i = 0; i < 4000; i++) {
        if (pred()) return true;
        await tick();
      }
      check(false, `не дождались: ${what}`);
      return false;
    };
    const visible = (sel: string): HTMLElement | null => {
      const overlay = root.querySelector(".combat-overlay") as HTMLElement | null;
      if (!overlay || overlay.classList.contains("combat-overlay--fx")) return null;
      return overlay.querySelector(sel) as HTMLElement | null;
    };
    const answer = (correct: boolean): void => {
      const q = questionByText.get(text(".combat-question"));
      if (!q) throw new Error(`вопрос не найден: ${text(".combat-question")}`);
      (root.querySelector(".combat-answer-input") as HTMLInputElement).value = String(correct ? q.answer : q.answer + 12345);
      (root.querySelector(".combat-submit") as HTMLButtonElement).click();
    };

    try {
      combat.startEncounter(createOpponentFactory(() => TRAINING_WITCH_POWER).witch(witch));
      check(combat.isActive && stage.controlsCamera && detached === 1, "бой начался: сцена взяла камеру");
      check(near(player.facingYaw, 0) && near(witch.root.rotation.y, Math.PI), "бойцы лицом друг к другу");

      // 1) Ведьма первая: защита с ошибкой → удар ведьмы (стоит запустить её анимацию и снять Силу).
      if (await until(() => visible(".combat-answer-input") !== null, "защита от ведьмы")) {
        check(text(".combat-badge") === "Атака ведьмы", "первой бьёт ведьма, заметившая игрока");
        answer(false);
      }
      await until(() => power.current < PLAYER_MAX_POWER, "удар ведьмы снял Силу");
      check(power.current === PLAYER_MAX_POWER - WITCH_HIT_DAMAGE, "Сила игрока упала ровно на удар ведьмы");
      check(swings === 1, "ведьма взмахнула посохом");
      check(root.querySelector(".battle-bar") !== null, "плашка шкал видна всё время боя (и пока окно спрятано)");

      // 2) Ход игрока: выбрать «Искру», верно ответить → слабая ведьма (30 Силы) падает.
      if (await until(() => visible(".bonfire-spell-option") !== null, "выбор заклинания")) {
        const spark = Array.from(root.querySelectorAll(".bonfire-spell-option")).find((o) => (o.querySelector(".bonfire-spell-name")?.textContent ?? "") === fireSpell.name) as HTMLElement;
        spark.click();
      }
      if (await until(() => visible(".combat-answer-input") !== null, "вопрос атаки")) answer(true);
      await until(() => visible(".combat-result-title") !== null, "итог боя");
      check(text(".combat-result-title") === "Победа!", "победа: у ведьмы кончилась Сила");
      (root.querySelector(".combat-submit") as HTMLButtonElement).click();
      await until(() => ended.length === 1, "бой завершён");
      check(ended[0] === "won" && !combat.isActive, "исход «победа» сообщён один раз, бой закрыт");
      check(!stage.controlsCamera && attached === 1, "после боя камера и мышь вернулись игроку");

      // 3) Какие анимации реально играли: камень (механика ведьмы) и пар (термодинамика игрока).
      check(scene.getMeshByName("fx_stone") !== null, "удар ведьмы-механика был камнем");
      check(scene.getMeshByName("fx_steam0") !== null, "удар игрока-термодинамика был паром");
      check(enabledFx(scene).length === 0, "после боя в сцене нет включённых эффектов");
    } finally {
      clearInterval(frames);
    }
    stage.dispose();
    scene.dispose();
  }

  engine.dispose();
  console.log(failures === 0 ? `OK: сцена боя — ${checks} проверок (ракурсы, камера, эффекты по школам, сквозной бой)` : `ПРОВАЛОВ: ${failures} из ${checks}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
