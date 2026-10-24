import { Color3, Vector3 } from "@babylonjs/core";
import type { ArcRotateCamera, Scene } from "@babylonjs/core";
import type { BattleStage, Strike } from "../BattleStage";
import type { BattleOpponent } from "../opponent";
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
  /** Замах противника перед вылетом заклинания (у игрока замаха нет — только короткая пауза). */
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

/** Что сцене нужно от игрока (так сцену можно проверять без настоящего PlayerController). */
export interface StagePlayer {
  readonly position: Vector3;
  /** Курс, в который смотрит модель игрока (0 = +Z). */
  readonly facingYaw: number;
  faceToward(x: number, z: number): void;
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

    if (strike.from === "opponent") opponent.playCast?.();
    await this.fx.play({
      kind: strikeKindFor(strike.spell),
      from: attacker,
      to: defender,
      color: Color3.FromHexString(strike.spell.color),
      result: strike.result,
      startDelay: strike.from === "opponent" ? STAGE_TIMING.opponentWindup : STAGE_TIMING.playerWindup,
      onImpact: impact,
    });
    impact(); // на случай, если показ оборвали до попадания
    if (!alive()) return;

    await this.director.hold(STAGE_TIMING.hold);
    if (!alive()) return;
    await this.director.glideTo(this.restPose(), STAGE_TIMING.returnGlide);
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

  private restPose() {
    return behindPlayerPose(this.player.position, this.player.facingYaw, this.restRadius);
  }
}
