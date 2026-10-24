import { easeInOutCubic } from "../../core/easing";
import { lerpPose, type CameraPose, type Vec3 } from "./stagePoses";

/** Минимум от ArcRotateCamera, который нужен режиссёру (так его можно проверять на заглушке). V — тип вектора камеры (Vector3). */
export interface CameraRig<V extends Vec3> {
  alpha: number;
  beta: number;
  radius: number;
  lowerBetaLimit?: number | null;
  upperBetaLimit?: number | null;
  lowerRadiusLimit?: number | null;
  upperRadiusLimit?: number | null;
  inertialAlphaOffset?: number;
  inertialBetaOffset?: number;
  inertialRadiusOffset?: number;
  getTarget(): V;
  /**
   * cloneAlphaBetaRadius = true обязателен: иначе Babylon пересчитывает alpha/beta/radius из текущей
   * позиции камеры, и заданная поза «съезжает».
   */
  setTarget(target: V, toBoundingCenter?: boolean, allowSamePosition?: boolean, cloneAlphaBetaRadius?: boolean): void;
}

/** Ввод игрока камерой: на время боя отключается, чтобы мышь не спорила с режиссёром. */
export interface CameraInputControl {
  detach(): void;
  attach(): void;
}

interface Move {
  from: CameraPose;
  to: CameraPose;
  elapsed: number;
  duration: number;
  resolve: () => void;
}

const clamp = (v: number, lo: number | null | undefined, hi: number | null | undefined): number => {
  let r = v;
  if (typeof lo === "number") r = Math.max(lo, r);
  if (typeof hi === "number") r = Math.min(hi, r);
  return r;
};

/**
 * Режиссёр камеры: плавно переводит ArcRotateCamera из позы в позу (с замедлением к концу) и
 * возвращает промис, когда переход закончен. Пока режиссёр у руля (takeOver…release), обычное
 * следование за игроком и мышь отключены. Ничего не делает, когда нет активного перехода.
 */
export class CameraDirector<V extends Vec3> {
  private directing = false;
  private move: Move | null = null;
  private readonly scratch: CameraPose = { alpha: 0, beta: 0, radius: 0, target: { x: 0, y: 0, z: 0 } };

  /**
   * @param targetVector — вектор, который режиссёр мутирует и отдаёт камере каждый кадр
   *   (один на всё время жизни: без мусора для сборщика на слабых устройствах).
   */
  constructor(
    private readonly rig: CameraRig<V>,
    private readonly input: CameraInputControl,
    private readonly targetVector: V
  ) {}

  /** Режиссёр сейчас управляет камерой. */
  public get isDirecting(): boolean {
    return this.directing;
  }

  /** Принять управление: мышь отключается, остаточное вращение гасится. */
  public takeOver(): void {
    if (this.directing) return;
    this.directing = true;
    this.input.detach();
    this.rig.inertialAlphaOffset = 0;
    this.rig.inertialBetaOffset = 0;
    this.rig.inertialRadiusOffset = 0;
  }

  /** Вернуть управление игроку. Незаконченные переходы завершаются на месте (промисы не зависают). */
  public release(): void {
    if (!this.directing) return;
    this.directing = false;
    const pending = this.move;
    this.move = null;
    pending?.resolve();
    this.input.attach();
  }

  /** Текущая поза камеры. */
  public currentPose(out: CameraPose = { alpha: 0, beta: 0, radius: 0, target: { x: 0, y: 0, z: 0 } }): CameraPose {
    const t = this.rig.getTarget();
    out.alpha = this.rig.alpha;
    out.beta = this.rig.beta;
    out.radius = this.rig.radius;
    out.target.x = t.x;
    out.target.y = t.y;
    out.target.z = t.z;
    return out;
  }

  /** Плавный переход в позу за `seconds` секунд. Новый переход заменяет прежний (тот завершается на месте). */
  public glideTo(pose: CameraPose, seconds: number): Promise<void> {
    if (!this.directing) return Promise.resolve();
    const from = this.currentPose();
    const to: CameraPose = { alpha: pose.alpha, beta: pose.beta, radius: pose.radius, target: { ...pose.target } };
    return this.startMove(from, to, seconds);
  }

  /** Постоять на месте `seconds` секунд (камера не двигается). */
  public hold(seconds: number): Promise<void> {
    if (!this.directing) return Promise.resolve();
    const from = this.currentPose();
    const to: CameraPose = { alpha: from.alpha, beta: from.beta, radius: from.radius, target: { ...from.target } };
    return this.startMove(from, to, seconds);
  }

  /** Мгновенно поставить камеру в позу. */
  public snapTo(pose: CameraPose): void {
    this.apply(pose);
  }

  /** Вызывается каждый кадр. */
  public update(dt: number): void {
    const move = this.move;
    if (!move || !this.directing) return;
    move.elapsed += dt;
    const t = move.duration > 0 ? Math.min(1, move.elapsed / move.duration) : 1;
    this.apply(lerpPose(move.from, move.to, easeInOutCubic(t), this.scratch));
    if (t >= 1) {
      this.move = null;
      move.resolve();
    }
  }

  private startMove(from: CameraPose, to: CameraPose, seconds: number): Promise<void> {
    const previous = this.move;
    previous?.resolve();
    return new Promise<void>((resolve) => {
      this.move = { from, to, elapsed: 0, duration: Math.max(0, seconds), resolve };
    });
  }

  private apply(pose: CameraPose): void {
    const rig = this.rig;
    rig.alpha = pose.alpha;
    rig.beta = clamp(pose.beta, rig.lowerBetaLimit, rig.upperBetaLimit);
    rig.radius = clamp(pose.radius, rig.lowerRadiusLimit, rig.upperRadiusLimit);
    this.targetVector.x = pose.target.x;
    this.targetVector.y = pose.target.y;
    this.targetVector.z = pose.target.z;
    rig.setTarget(this.targetVector, false, true, true);
  }
}
