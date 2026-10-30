/**
 * test-battle-animation.ts — жесты героя в бою (BabylonBattleStage + PlayerAnimator).
 *  A. Набор жестов каста по виду заклинания: полный, разнообразный (одна рука / обе), у каждого есть момент выпуска.
 *  B. Сцена с записывающей заглушкой: порядок и тайминг (каст → вылет в момент «выпуска» → «есть!»/фейспалм;
 *     защита → отдача/щит), исходы боя, обрыв боя посреди удара, сцена без аниматора.
 *  C. Сцена с настоящим аниматором: герой действительно выглядит так, как задумано, и всё доигрывается до покоя.
 * Запуск: npm run test:battle-animation.
 */
import { ArcRotateCamera, NullEngine, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { BabylonBattleStage, STAGE_TIMING } from "../src/combat/stage/BabylonBattleStage";
import type { StageAnimator, StagePlayer } from "../src/combat/stage/BabylonBattleStage";
import { CAST_GESTURES, castGesturesFor } from "../src/combat/stage/playerCasts";
import { strikeKindFor } from "../src/combat/stage/strikeKinds";
import { EFFECT_FACTORIES } from "../src/combat/stage/strikeRecipes";
import type { StrikeKind } from "../src/combat/stage/strikeRecipes";
import type { BattleOpponent } from "../src/combat/opponent";
import { PlayerController } from "../src/core/PlayerController";
import { BLOCK_FOR_GUARD, CHALLENGE_GESTURES, DEFEAT_GESTURES, GESTURES, GUARD_GESTURES, HIT_CHEER_GESTURES, HIT_RECOIL_GESTURES, MISS_GESTURES, RELIEF_GESTURES, VICTORY_GESTURES } from "../src/core/playerGestures";
import type { GestureId } from "../src/core/playerGestures";
import { getSpellById } from "../src/data/spells";

declare const process: { exit(code?: number): never };

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  }
}

const DT = 1 / 60;
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
async function pump(update: (dt: number) => void, done: () => boolean, maxSeconds = 12): Promise<number> {
  let t = 0;
  while (!done() && t < maxSeconds) {
    update(DT);
    t += DT;
    await tick();
  }
  return t;
}

const engine = new NullEngine();
const earthSpell = getSpellById("velocity"); // школа «механика» → камень
const fireSpell = getSpellById("spark"); // «термодинамика» → пар

// ---------------------------------------------------------------------------
// A. Набор жестов каста
// ---------------------------------------------------------------------------
{
  const kinds = Object.keys(EFFECT_FACTORIES) as StrikeKind[];
  check(kinds.every((k) => castGesturesFor(k).length >= 2), "для каждого вида заклинания — не меньше двух жестов каста (разнообразие)");
  check(Object.keys(CAST_GESTURES).sort().join() === [...kinds].sort().join(), "набор жестов описан ровно для тех видов, что есть у эффектов");
  const all = new Set<GestureId>(kinds.flatMap((k) => [...castGesturesFor(k)]));
  check([...all].every((id) => GESTURES[id].releaseAt !== undefined && GESTURES[id].priority === 2), "у каждого жеста каста есть момент выпуска и боевой приоритет");
  const oneHand = ["castRight", "castLeft", "castPoint", "castCircle"] as GestureId[];
  const bothHands = ["castBoth", "castOverhead"] as GestureId[];
  check(oneHand.some((g) => all.has(g)) && bothHands.some((g) => all.has(g)), "касты бывают и одной рукой, и обеими");
  check(kinds.every((k) => castGesturesFor(k).some((g) => bothHands.includes(g)) && castGesturesFor(k).some((g) => oneHand.includes(g))), "у каждого вида есть и вариант одной рукой, и вариант обеими");
  check(all.has("castLeft") && all.has("castRight"), "бывает и левая, и правая рука");
}

// ---------------------------------------------------------------------------
// Окружение сцены
// ---------------------------------------------------------------------------
function makeEnv<P extends StagePlayer>(makePlayer: (scene: Scene) => P) {
  const scene = new Scene(engine);
  scene.collisionsEnabled = true;
  const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.6, 9, new Vector3(0, 1, 0), scene);
  camera.lowerBetaLimit = 0.5;
  camera.upperBetaLimit = Math.PI / 2.1;
  camera.lowerRadiusLimit = 4;
  camera.upperRadiusLimit = 14;
  const player = makePlayer(scene);
  const anchor = new TransformNode("opp", scene);
  anchor.position.set(0, 0, 2);
  const opponent = { kind: "target", id: "o1", anchor, aimHeight: 1.3, playCast: () => {} } as unknown as BattleOpponent;
  const stage = new BabylonBattleStage({ scene, camera, player, input: { attach: () => {}, detach: () => {} } });
  return { scene, camera, player, opponent, stage };
}

/** Аниматор-заглушка: записывает вызовы вместе с «временем сцены». */
class RecordingAnimator implements StageAnimator {
  public log: Array<{ at: number; call: string; arg?: string; force?: boolean }> = [];
  public now = 0;
  public stopped = 0;
  public chosen: GestureId | null = null;
  /** Жест, выбранный именно для каста (после него выбираются и другие). */
  public castChosen: GestureId | null = null;
  /** Какой по счёту жест набора «выбирает» заглушка (в игре выбор случайный). */
  public pickIndex = 0;
  play(id: GestureId, force?: boolean): boolean {
    this.log.push({ at: this.now, call: "play", arg: id, force });
    return true;
  }
  playOneOf(ids: readonly GestureId[], poolKey?: string, force?: boolean): GestureId | null {
    this.chosen = ids[this.pickIndex % ids.length];
    if (poolKey?.startsWith("cast:")) this.castChosen = this.chosen;
    this.log.push({ at: this.now, call: "playOneOf", arg: `${poolKey ?? ""}|${ids.join("+")}`, force });
    return this.chosen;
  }
  releaseAt(id: GestureId): number {
    return GESTURES[id].releaseAt ?? 0;
  }
  stopGesture(): void {
    this.stopped++;
  }
  names(): string[] {
    // play → сам жест; playOneOf → имя набора («cast:stone» → «cast»).
    return this.log.map((e) => (e.call === "play" ? e.arg! : e.arg!.split("|")[0].split(":")[0]));
  }
}

function makeStubEnv(withAnimator = true) {
  const animator = new RecordingAnimator();
  const env = makeEnv((): StagePlayer & { facingYaw: number } => ({
    position: new Vector3(0, 1, 0),
    facingYaw: 0,
    faceToward(x: number, z: number) {
      this.facingYaw = Math.atan2(x - this.position.x, z - this.position.z);
    },
    animator: withAnimator ? animator : undefined,
  }));
  const run = async (strike: Parameters<BabylonBattleStage["strike"]>[0]): Promise<{ seconds: number; impactAt: number }> => {
    let done = false;
    let impactAt = NaN;
    void env.stage.strike({ ...strike, onImpact: () => { impactAt = animator.now; strike.onImpact?.(); } }).then(() => (done = true));
    const seconds = await pump((dt) => { animator.now += dt; env.stage.update(dt); }, () => done, 8);
    check(done, "показ удара завершился");
    return { seconds, impactAt };
  };
  const settle = async (): Promise<void> => {
    await pump((dt) => { animator.now += dt; env.stage.update(dt); }, () => false, STAGE_TIMING.beginGlide + 0.1);
  };
  return { ...env, animator, run, settle };
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------------
  // B. Сцена с записывающей заглушкой
  // ---------------------------------------------------------------------------
  {
    const env = makeStubEnv();
    env.stage.begin(env.opponent);
    check(env.animator.stopped === 1, "начало боя: недодёрнутый «скучающий» жест снимается");
    check(env.animator.log.length === 1 && env.animator.log[0].arg === `challenge|${CHALLENGE_GESTURES.join("+")}` && env.animator.log[0].force === true, "начало боя: герой бросает вызов противнику (один из жестов набора)");
    await env.settle();

    // Удар игрока, попал.
    env.animator.log = [];
    const hit = await env.run({ from: "player", spell: earthSpell, result: "hit" });
    check(env.animator.names().join() === "cast,hitCheer", `игрок попал: каст, потом «есть!» из набора (${env.animator.names().join()})`);
    check(env.animator.log[1].arg === `hitCheer|${HIT_CHEER_GESTURES.join("+")}`, "«есть!» выбирается из набора вариантов");
    const cast = env.animator.log[0];
    check(cast.force === true && cast.arg === `cast:${strikeKindFor(earthSpell)}|${castGesturesFor(strikeKindFor(earthSpell)).join("+")}`, "жест каста выбирается из набора по виду заклинания");
    const release = GESTURES[env.animator.castChosen!].releaseAt!;
    const flightStart = cast.at + release;
    check(hit.impactAt > flightStart, `заклинание вылетает не раньше «выпуска» жеста: попадание на ${(hit.impactAt - cast.at).toFixed(2)} с после начала каста (выпуск ${release} с)`);
    check(env.animator.log[1].at >= hit.impactAt, "«есть!» — после попадания, а не до него");

    // Промах.
    env.animator.log = [];
    await env.run({ from: "player", spell: earthSpell, result: "missed" });
    check(env.animator.names().join() === "cast,miss" && env.animator.log[1].arg === `miss|${MISS_GESTURES.join("+")}`, `игрок промахнулся: каст, потом реакция из набора (${env.animator.names().join()})`);
    check(env.animator.log[1].force === true, "реакция на промах вытесняет каст (force)");

    // Удар противника: защита на замахе, потом реакция ровно в момент попадания.
    for (const [result, expected] of [["hit", "guard,hitRecoil"], ["blocked", "guard,blockImpact"], ["missed", "guard"]] as const) {
      env.animator.log = [];
      let order: string[] = [];
      const r = await env.run({ from: "opponent", spell: fireSpell, result, onImpact: () => { order = env.animator.names(); } });
      check(env.animator.names().join() === expected, `удар противника «${result}»: ${expected} (${env.animator.names().join()})`);
      if (result !== "missed") check(order.join() === expected, `удар противника «${result}»: реакция сыграна к моменту попадания, а не позже`);
      const guard = env.animator.log[0];
      check(guard.force === true && guard.at < r.impactAt && guard.arg === `guard|${GUARD_GESTURES.join("+")}`, `удар противника «${result}»: защита из набора поднята до попадания`);
      if (result === "hit") check(env.animator.log[1].arg === `hitRecoil|${HIT_RECOIL_GESTURES.join("+")}`, "отдача выбирается из набора вариантов");
    }

    // Удар в защиту продолжает именно ту защиту, которую герой выбрал на замахе.
    for (let i = 0; i < GUARD_GESTURES.length; i++) {
      env.animator.pickIndex = i;
      env.animator.log = [];
      await env.run({ from: "opponent", spell: fireSpell, result: "blocked" });
      const guardId = GUARD_GESTURES[i];
      check(env.animator.names().join() === `guard,${BLOCK_FOR_GUARD[guardId]}`, `защита «${guardId}» → удар в неё «${BLOCK_FOR_GUARD[guardId]}» (${env.animator.names().join()})`);
    }
    env.animator.pickIndex = 0;

    // Исходы.
    env.animator.log = [];
    env.stage.outcome("won");
    check(env.animator.log.length === 1 && env.animator.log[0].call === "playOneOf" && env.animator.log[0].arg === `victory|${VICTORY_GESTURES.join("+")}` && env.animator.log[0].force === true, "победа: случайный торжествующий жест из набора");
    env.animator.log = [];
    env.stage.outcome("lost");
    check(env.animator.names().join() === "defeat" && env.animator.log[0].arg === `defeat|${DEFEAT_GESTURES.join("+")}` && env.animator.log[0].force === true, "поражение: один из жестов поражения");
    env.animator.log = [];
    env.stage.outcome("retreated");
    check(env.animator.names().join() === "relief" && env.animator.log[0].arg === `relief|${RELIEF_GESTURES.join("+")}` && env.animator.log[0].force === true, "отступление: один из жестов облегчения");
    env.stage.end();
  }

  {
    // Обрыв боя посреди удара: после конца боя никаких реакций.
    const env = makeStubEnv();
    env.stage.begin(env.opponent);
    await env.settle();
    env.animator.log = [];
    let done = false;
    void env.stage.strike({ from: "player", spell: earthSpell, result: "hit" }).then(() => (done = true));
    await pump((dt) => { env.animator.now += dt; env.stage.update(dt); }, () => false, STAGE_TIMING.shotGlide / 2);
    env.stage.end();
    await pump((dt) => { env.animator.now += dt; env.stage.update(dt); }, () => done, 3);
    check(done, "обрыв боя: показ удара не зависает");
    check(!env.animator.names().includes("hitCheer") && !env.animator.names().includes("miss"), "обрыв боя: после конца боя героя не заставляют радоваться");
  }

  {
    // Сцена без аниматора у игрока работает, как раньше.
    const env = makeStubEnv(false);
    env.stage.begin(env.opponent);
    await env.settle();
    let impacts = 0;
    const r = await env.run({ from: "player", spell: earthSpell, result: "hit", onImpact: () => impacts++ });
    check(impacts === 1 && r.seconds < 2.4, "без аниматора удар показывается как прежде, и без задержки на замах");
    await env.run({ from: "opponent", spell: fireSpell, result: "hit", onImpact: () => impacts++ });
    check(impacts === 2, "без аниматора удар противника тоже показывается");
    env.stage.outcome("won");
    env.stage.outcome("lost");
    env.stage.outcome("retreated");
    check(true, "без аниматора исход боя ничего не ломает");
    env.stage.end();
  }

  // ---------------------------------------------------------------------------
  // C. Сцена с настоящим аниматором
  // ---------------------------------------------------------------------------
  {
    const FWD = new Vector3(0, 0, 1);
    const RIGHT = new Vector3(1, 0, 0);
    let pc!: PlayerController;
    const env = makeEnv((scene) => {
      pc = new PlayerController(scene, new Vector3(0, 1, 0), { isDown: () => false });
      pc.inputLocked = true;
      return pc;
    });
    const frame = (dt: number): void => {
      env.stage.update(dt);
      pc.collider.computeWorldMatrix(true);
      pc.update(dt, FWD, RIGHT);
    };
    const seenGestures: string[] = [];
    const watch = (dt: number): void => {
      frame(dt);
      const g = pc.animator.currentGesture;
      if (g && seenGestures[seenGestures.length - 1] !== g) seenGestures.push(g);
    };

    env.stage.begin(env.opponent);
    check(CHALLENGE_GESTURES.includes(pc.animator.currentGesture as GestureId), `начало боя: играет жест-вызов (${pc.animator.currentGesture})`);
    pc.animator.setHeld("battleStance"); // стойку в игре держат реакции (PlayerReactions)
    await pump(frame, () => false, STAGE_TIMING.beginGlide + 0.1);

    // Каст «камнем»: жест из набора, к выпуску нужная рука вытянута вперёд.
    let castSeen: string | null = null;
    let handForwardAtRelease = false;
    let done = false;
    void env.stage.strike({ from: "player", spell: earthSpell, result: "hit" }).then(() => (done = true));
    let t = 0;
    let castStart = -1;
    while (!done && t < 8) {
      watch(DT);
      t += DT;
      const g = pc.animator.currentGesture;
      if (g && castSeen === null && castGesturesFor("stone").includes(g)) {
        castSeen = g;
        castStart = t;
      }
      if (castSeen !== null && castStart >= 0 && t - castStart >= GESTURES[castSeen as GestureId].releaseAt! - DT && !handForwardAtRelease) {
        for (const arm of ["armL", "armR"] as const) {
          const mesh = env.scene.getMeshByName(arm)!;
          mesh.computeWorldMatrix(true);
          const tip = Vector3.TransformCoordinates(new Vector3(0, -0.375, 0), mesh.getWorldMatrix());
          // позиция в системе игрока: игрок смотрит на противника (+Z), поэтому «вперёд» — это +Z
          if (tip.z - pc.position.z > 0.5) handForwardAtRelease = true;
        }
      }
      await tick();
    }
    check(castSeen !== null, `герой кастует жестом из набора для камня (${castSeen})`);
    check(handForwardAtRelease, "в момент выпуска хотя бы одна рука вытянута к противнику");
    check(seenGestures.some((g) => HIT_CHEER_GESTURES.includes(g as GestureId)), `после меткого попадания герой радуется (${seenGestures.join()})`);
    await pump(frame, () => !pc.animator.isBusy, 4);
    check(!pc.animator.isBusy, "после удара все жесты доигрываются");
    check(pc.animator.heldPose === "battleStance" && Math.abs(pc.animator.pose.legLPitch - -0.28) < 0.05, "после жестов герой возвращается в боевую стойку");

    // Защита и отдача.
    seenGestures.length = 0;
    done = false;
    void env.stage.strike({ from: "opponent", spell: fireSpell, result: "hit" }).then(() => (done = true));
    await pump(watch, () => done, 8);
    check(seenGestures.length === 2 && GUARD_GESTURES.includes(seenGestures[0] as GestureId) && HIT_RECOIL_GESTURES.includes(seenGestures[1] as GestureId), `удар противника попал: защита, потом отдача (${seenGestures.join()})`);
    await pump(frame, () => !pc.animator.isBusy, 4);
    seenGestures.length = 0;
    done = false;
    void env.stage.strike({ from: "opponent", spell: fireSpell, result: "blocked" }).then(() => (done = true));
    await pump(watch, () => done, 8);
    check(seenGestures.length === 2 && GUARD_GESTURES.includes(seenGestures[0] as GestureId) && seenGestures[1] === BLOCK_FOR_GUARD[seenGestures[0]], `удар отбит: защита, потом толчок именно этой защиты (${seenGestures.join()})`);
    await pump(frame, () => !pc.animator.isBusy, 4);

    // Промах и победа.
    seenGestures.length = 0;
    done = false;
    void env.stage.strike({ from: "player", spell: earthSpell, result: "missed" }).then(() => (done = true));
    await pump(watch, () => done, 8);
    check(MISS_GESTURES.includes(seenGestures[seenGestures.length - 1] as GestureId), `промах игрока: герой досадует (${seenGestures.join()})`);
    await pump(frame, () => !pc.animator.isBusy, 4);

    env.stage.outcome("won");
    check(VICTORY_GESTURES.includes(pc.animator.currentGesture as GestureId), `победа: играет торжествующий жест (${pc.animator.currentGesture})`);
    await pump(frame, () => false, 1.2);
    env.stage.end();
    await pump(frame, () => !pc.animator.isBusy, 4);
    check(!pc.animator.isBusy, "победный жест доигрывается до покоя");

    env.stage.outcome("lost");
    check(DEFEAT_GESTURES.includes(pc.animator.currentGesture as GestureId), `поражение: персонаж сникает (${pc.animator.currentGesture})`);
    await pump(frame, () => !pc.animator.isBusy, 5);
    env.stage.outcome("retreated");
    check(RELIEF_GESTURES.includes(pc.animator.currentGesture as GestureId), `отступление: персонаж выдыхает (${pc.animator.currentGesture})`);
    await pump(frame, () => !pc.animator.isBusy, 5);
    check(!pc.animator.isBusy, "все жесты исходов доигрываются");

    // Разнообразие: за много побед выпадают все варианты и никакой не повторяется подряд.
    const seen = new Set<string>();
    let last = "";
    let repeats = 0;
    for (let i = 0; i < 60; i++) {
      env.stage.outcome("won");
      const g = pc.animator.currentGesture ?? "";
      seen.add(g);
      if (g === last) repeats++;
      last = g;
      for (let k = 0; k < 200; k++) frame(DT);
    }
    check(seen.size === VICTORY_GESTURES.length, `за 60 побед встретились все ${VICTORY_GESTURES.length} торжествующих жестов (${seen.size})`);
    check(repeats === 0, "один и тот же победный жест не выпадает дважды подряд");

    // Разнообразие кастов: у «орба» (4 жеста) за серию ударов встречаются разные руки.
    const casts = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const id = pc.animator.playOneOf(castGesturesFor("orb"), "cast:orb", true);
      if (id) casts.add(id);
      for (let k = 0; k < 90; k++) frame(DT);
    }
    check(casts.size === castGesturesFor("orb").length, `за 40 кастов встретились все ${castGesturesFor("orb").length} жеста «шара» (${[...casts].join(",")})`);

    // Разнообразие остальных реакций боя: за серию встречаются все варианты.
    for (const [name, outcome, pool] of [["поражение", "lost", DEFEAT_GESTURES], ["отступление", "retreated", RELIEF_GESTURES]] as const) {
      const got = new Set<string>();
      for (let i = 0; i < 30; i++) {
        env.stage.outcome(outcome);
        got.add(pc.animator.currentGesture ?? "");
        for (let k = 0; k < 200; k++) frame(DT);
      }
      check(got.size === pool.length, `${name}: за 30 раз встретились все ${pool.length} варианта (${[...got].join(",")})`);
    }
    for (const [name, pool, key] of [["отдача", HIT_RECOIL_GESTURES, "hitRecoil"], ["радость", HIT_CHEER_GESTURES, "hitCheer"], ["досада", MISS_GESTURES, "miss"]] as const) {
      const got = new Set<string>();
      for (let i = 0; i < 40; i++) {
        const id = pc.animator.playOneOf(pool, key, true);
        if (id) got.add(id);
        for (let k = 0; k < 120; k++) frame(DT);
      }
      check(got.size === pool.length, `${name}: за 40 раз встретились все ${pool.length} варианта`);
    }

    env.stage.end();
  }

  engine.dispose();
  console.log(failures === 0 ? `OK: боевые анимации — ${checks} проверок (касты по видам, защита и отдача, исходы, сцена с аниматором и без)` : `ПРОВАЛОВ: ${failures} из ${checks}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
