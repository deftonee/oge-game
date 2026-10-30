import { Color3, Vector3 } from "@babylonjs/core";
import type { ArcRotateCamera, Scene } from "@babylonjs/core";
import type { BattleStage, Strike } from "../BattleStage";
import type { BattleOpponent, BattleOutcome } from "../opponent";
import {
  BLOCK_FOR_GUARD,
  CHALLENGE_GESTURES,
  DEFEAT_GESTURES,
  GUARD_GESTURES,
  HIT_CHEER_GESTURES,
  HIT_RECOIL_GESTURES,
  MISS_GESTURES,
  RELIEF_GESTURES,
  VICTORY_GESTURES,
} from "../../core/playerGestures";
import type { GestureId } from "../../core/playerGestures";
import { castGesturesFor } from "./playerCasts";
import { CameraDirector } from "./CameraDirector";
import type { CameraInputControl } from "./CameraDirector";
import { StrikeFx } from "./StrikeFx";
import { behindPlayerPose, strikeShotPose, yawToward } from "./stagePoses";
import { strikeKindFor } from "./strikeKinds";

/** Секунды: сколько длится каждый кусок показа удара. */
export const STAGE_TIMING = {
  /** Камера занимает место «за спиной» в начале боя. */
  beginGlide: 0.5,
  /** Камера переходит на ракурс удара. */
  shotGlide: 0.35,
  /**
   * Замах противника перед вылетом заклинания. У игрока замах — его жест каста: заклинание вылетает
   * в момент «выпуска» жеста (PlayerAnimator.releaseAt); playerWindup — минимум, если жеста нет.
   */
  opponentWindup: 0.18,
  playerWindup: 0.05,
  /** Камера задерживается на месте попадания. */
  hold: 0.12,
  /** Камера возвращается за спину игрока. */
  returnGlide: 0.45,
} as const;

/** Выше центра коллайдера игрока: примерно грудь, откуда «вылетает» заклинание. */
const PLAYER_AIM_LIFT = 0.15;
/** Сцена не должна «перематывать» анимацию после лага или паузы вкладки. */
const MAX_FRAME_SECONDS = 0.1;

/** Что сцене нужно от аниматора игрока (PlayerAnimator подходит как есть). */
export interface StageAnimator {
  play(id: GestureId, force?: boolean): boolean;
  playOneOf(ids: readonly GestureId[], poolKey?: string, force?: boolean): GestureId | null;
  releaseAt(id: GestureId): number;
  stopGesture(): void;
}

/** Что сцене нужно от игрока (так сцену можно проверять без настоящего PlayerController). */
export interface StagePlayer {
  readonly position: Vector3;
  /** Курс, в который смотрит модель игрока (0 = +Z). */
  readonly facingYaw: number;
  faceToward(x: number, z: number): void;
  /** Жесты героя в бою (каст, защита, отдача, радость). Без него сцена работает молча, как раньше. */
  readonly animator?: StageAnimator;
}

export interface BattleStageDeps {
  scene: Scene;
  camera: ArcRotateCamera;
  player: StagePlayer;
  /** Отключение/включение мыши-камеры на время боя. */
  input: CameraInputControl;
}

/**
 * 3D-сцена боя: разворачивает бойцов лицом друг к другу, на каждом ударе переводит камеру на удобный
 * ракурс, проигрывает анимацию заклинания (вид зависит от школы) и возвращает камеру за спину игрока.
 *
 * Игровой цикл зовёт update(dt) каждый кадр и пока controlsCamera — не двигает камеру за игроком сам.
 * В простое ничего не считает и не рисует.
 */
export class BabylonBattleStage implements BattleStage {
  private readonly director: CameraDirector<Vector3>;
  private readonly fx: StrikeFx;
  private readonly camera: ArcRotateCamera;
  private readonly player: StagePlayer;
  private opponent: BattleOpponent | null = null;
  /** Номер боя: ответы на устаревшие await'ы (бой уже закончен) отбрасываются. */
  private session = 0;
  private restRadius = 0;

  constructor(deps: BattleStageDeps) {
    this.camera = deps.camera;
    this.player = deps.player;
    this.director = new CameraDirector<Vector3>(deps.camera, deps.input, new Vector3());
    this.fx = new StrikeFx(deps.scene);
  }

  /** Камерой сейчас управляет бой: игровой цикл не должен её двигать. */
  public get controlsCamera(): boolean {
    return this.director.isDirecting;
  }

  public begin(opponent: BattleOpponent): void {
    this.session++;
    this.opponent = opponent;

    const p = this.player.position;
    const o = opponent.anchor.position;
    this.player.faceToward(o.x, o.z);
    this.player.animator?.stopGesture(); // недочёсанная голова не должна торчать из боевой стойки
    this.player.animator?.playOneOf(CHALLENGE_GESTURES, "challenge", true); // вызов противнику
    if (opponent.faceToward) opponent.faceToward(p.x, p.z);
    else opponent.anchor.rotation.y = yawToward(o.x, o.z, p.x, p.z);

    this.restRadius = this.camera.radius;
    this.director.takeOver();
    void this.director.glideTo(this.restPose(), STAGE_TIMING.beginGlide);
  }

  public async strike(strike: Strike): Promise<void> {
    const opponent = this.opponent;
    const session = this.session;
    let impacted = false;
    const impact = (): void => {
      if (impacted) return;
      impacted = true;
      strike.onImpact?.();
    };
    if (!opponent) {
      impact();
      return;
    }
    const alive = (): boolean => this.session === session;

    const playerPoint = new Vector3(this.player.position.x, this.player.position.y + PLAYER_AIM_LIFT, this.player.position.z);
    const o = opponent.anchor.position;
    const opponentPoint = new Vector3(o.x, o.y + opponent.aimHeight, o.z);
    const [attacker, defender] = strike.from === "player" ? [playerPoint, opponentPoint] : [opponentPoint, playerPoint];

    await this.director.glideTo(strikeShotPose(attacker, defender, this.camera.alpha), STAGE_TIMING.shotGlide);
    if (!alive()) return impact();

    const kind = strikeKindFor(strike.spell);
    const animator = this.player.animator;
    let startDelay: number = strike.from === "opponent" ? STAGE_TIMING.opponentWindup : STAGE_TIMING.playerWindup;
    let guard: GestureId | null = null;
    if (strike.from === "opponent") {
      opponent.playCast?.();
      guard = animator?.playOneOf(GUARD_GESTURES, "guard", true) ?? null; // закрывается от удара, пока тот летит
    } else if (animator) {
      // Каст: то одной рукой, то обеими; заклинание вылетает в момент «выпуска» жеста.
      const cast = animator.playOneOf(castGesturesFor(kind), `cast:${kind}`, true);
      if (cast) startDelay = Math.max(startDelay, animator.releaseAt(cast));
    }
    await this.fx.play({
      kind,
      from: attacker,
      to: defender,
      color: Color3.FromHexString(strike.spell.color),
      result: strike.result,
      startDelay,
      onImpact: () => {
        if (!impacted) this.reactToImpact(strike, guard);
        impact();
      },
    });
    impact(); // на случай, если показ оборвали до попадания
    if (!alive()) return;
    this.reactToOwnStrike(strike);

    await this.director.hold(STAGE_TIMING.hold);
    if (!alive()) return;
    await this.director.glideTo(this.restPose(), STAGE_TIMING.returnGlide);
  }

  /** Исход боя: победитель радуется (каждый раз по-разному), проигравший сникает, отступивший выдыхает. */
  public outcome(outcome: BattleOutcome): void {
    const animator = this.player.animator;
    if (!animator) return;
    if (outcome === "won") animator.playOneOf(VICTORY_GESTURES, "victory", true);
    else if (outcome === "lost") animator.playOneOf(DEFEAT_GESTURES, "defeat", true);
    else animator.playOneOf(RELIEF_GESTURES, "relief", true);
  }

  public end(): void {
    this.session++;
    this.opponent = null;
    this.fx.cancel();
    this.director.release();
  }

  /** Кадр сцены: камера и эффекты. */
  public update(dt: number): void {
    const step = Math.min(dt, MAX_FRAME_SECONDS);
    this.director.update(step);
    this.fx.update(step);
  }

  public dispose(): void {
    this.end();
    this.fx.dispose();
  }

  /** Чужой удар долетел: щит принял его (толчок, руки дрожат) или он попал (отбросило). */
  private reactToImpact(strike: Strike, guard: GestureId | null): void {
    const animator = this.player.animator;
    if (!animator || strike.from !== "opponent") return;
    // Удар в защиту продолжает ту самую защиту, которую герой выбрал на замахе.
    if (strike.result === "blocked") animator.play((guard && BLOCK_FOR_GUARD[guard]) || "blockImpact", true);
    else if (strike.result === "hit") animator.playOneOf(HIT_RECOIL_GESTURES, "hitRecoil", true);
  }

  /** Свой удар показан: попал — «есть!», ушёл мимо — ладонью по лицу. */
  private reactToOwnStrike(strike: Strike): void {
    const animator = this.player.animator;
    if (!animator || strike.from !== "player") return;
    if (strike.result === "hit") animator.playOneOf(HIT_CHEER_GESTURES, "hitCheer", true);
    else if (strike.result === "missed") animator.playOneOf(MISS_GESTURES, "miss", true);
  }

  private restPose() {
    return behindPlayerPose(this.player.position, this.player.facingYaw, this.restRadius);
  }
}
