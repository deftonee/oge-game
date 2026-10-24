import { Color3, MeshBuilder, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { Mesh, Scene } from "@babylonjs/core";
import { clamp01, easeOutCubic, lerp } from "../../core/easing";
import type { StrikeResult } from "../BattleStage";
import { strikeEndPoint } from "./stagePoses";
import { EFFECT_FACTORIES } from "./strikeRecipes";
import type { EffectFactory, StrikeEffect, StrikeKind } from "./strikeRecipes";

export interface StrikeRequest {
  kind: StrikeKind;
  from: Vector3;
  /** Куда целились; конечная точка полёта зависит от result (в цель / в щит / мимо). */
  to: Vector3;
  color: Color3;
  result: StrikeResult;
  /** Пауза перед стартом полёта (замах), с. */
  startDelay?: number;
  /** Зовётся один раз в момент попадания (для «попал» и «отражён» — когда заклинание достигло цели или щита). */
  onImpact?: () => void;
}

const FLASH_SECONDS = 0.28;
/** Размер вспышки: попадание крупнее, чем удар о щит. */
const FLASH_SIZE: Readonly<Record<StrikeResult, number>> = { hit: 1.5, blocked: 1.15, missed: 0 };

interface Play {
  readonly effect: StrikeEffect;
  readonly req: StrikeRequest;
  readonly from: Vector3;
  readonly to: Vector3;
  readonly resolve: () => void;
  /** Время от старта; отрицательное — ещё длится замах. */
  elapsed: number;
  started: boolean;
  impacted: boolean;
  flightDone: boolean;
  /** Сколько секунд идёт вспышка (-1 — вспышки нет). */
  flashElapsed: number;
}

/**
 * Проигрыватель анимаций ударов: берёт рецепт по виду (камень, пар, луч…), ведёт таймлайн
 * «замах → полёт → попадание» и вспышку на цели. Эффекты создаются лениво, при первом ударе
 * такого вида, и живут до dispose(); в простое update() ничего не делает.
 * Одновременно играет один удар: новый обрывает прежний.
 */
export class StrikeFx {
  private readonly effects = new Map<StrikeKind, StrikeEffect>();
  private flash: Mesh | null = null;
  private flashMat: StandardMaterial | null = null;
  private current: Play | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly factories: Readonly<Record<StrikeKind, EffectFactory>> = EFFECT_FACTORIES
  ) {}

  public get isPlaying(): boolean {
    return this.current !== null;
  }

  /** Сколько эффектов уже создано (для проверки «лениво»). */
  public get createdKinds(): StrikeKind[] {
    return [...this.effects.keys()];
  }

  /** Проиграть удар. Промис завершается, когда полёт и вспышка закончились (или удар отменён). */
  public play(req: StrikeRequest): Promise<void> {
    this.cancel();
    const effect = this.effectFor(req.kind);
    const to = this.endPoint(req);
    return new Promise<void>((resolve) => {
      this.current = {
        effect,
        req,
        from: req.from.clone(),
        to,
        resolve,
        elapsed: -(req.startDelay ?? 0),
        started: false,
        impacted: false,
        flightDone: false,
        flashElapsed: -1,
      };
    });
  }

  /** Кадр анимации. */
  public update(dt: number): void {
    const play = this.current;
    if (!play) return;

    if (play.flashElapsed >= 0) this.stepFlash(play, dt);

    if (!play.flightDone) {
      play.elapsed += dt;
      if (play.elapsed >= 0) {
        if (!play.started) {
          play.started = true;
          play.effect.begin({ from: play.from, to: play.to }, play.req.color);
        }
        const p = clamp01(play.elapsed / play.effect.flightSeconds);
        play.effect.update(p, dt);
        if (!play.impacted && p >= play.effect.impactAt) this.impact(play);
        if (p >= 1) {
          play.flightDone = true;
          play.effect.end();
        }
      }
    }

    if (play.flightDone && play.flashElapsed < 0) this.finish(play);
  }

  /** Оборвать текущий удар: эффекты гаснут, ожидающий промис завершается. */
  public cancel(): void {
    const play = this.current;
    if (play) this.finish(play);
  }

  public dispose(): void {
    this.cancel();
    for (const effect of this.effects.values()) effect.dispose();
    this.effects.clear();
    this.flash?.dispose(false, false);
    this.flashMat?.dispose();
    this.flash = null;
    this.flashMat = null;
  }

  // ---------- Внутреннее ----------

  private effectFor(kind: StrikeKind): StrikeEffect {
    let effect = this.effects.get(kind);
    if (!effect) {
      effect = this.factories[kind](this.scene);
      this.effects.set(kind, effect);
    }
    return effect;
  }

  private endPoint(req: StrikeRequest): Vector3 {
    const end = strikeEndPoint(req.from, req.to, req.result);
    return new Vector3(end.x, end.y, end.z);
  }

  private impact(play: Play): void {
    play.impacted = true;
    const size = FLASH_SIZE[play.req.result];
    if (size > 0) this.startFlash(play, size);
    try {
      play.req.onImpact?.();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[stage] onImpact упал:", err);
    }
  }

  private startFlash(play: Play, size: number): void {
    if (!this.flash || !this.flashMat) {
      const mat = new StandardMaterial("fx_flashMat", this.scene);
      mat.disableLighting = true;
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      const mesh = MeshBuilder.CreateSphere("fx_flash", { diameter: 1, segments: 6 }, this.scene);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.flash = mesh;
      this.flashMat = mat;
    }
    // Попадание — цвет заклинания, щит — бледная вспышка.
    this.flashMat.emissiveColor =
      play.req.result === "blocked" ? Color3.Lerp(play.req.color, Color3.White(), 0.6) : play.req.color;
    this.flash.position.copyFrom(play.to);
    this.flash.scaling.setAll(0.4 * size);
    this.flash.visibility = 0.85;
    this.flash.setEnabled(true);
    play.flashElapsed = 0;
  }

  private stepFlash(play: Play, dt: number): void {
    const flash = this.flash;
    if (!flash) {
      play.flashElapsed = -1;
      return;
    }
    play.flashElapsed += dt;
    const t = clamp01(play.flashElapsed / FLASH_SECONDS);
    flash.scaling.setAll(lerp(0.4, 1, easeOutCubic(t)) * FLASH_SIZE[play.req.result]);
    flash.visibility = 0.85 * (1 - t);
    if (t >= 1) {
      flash.setEnabled(false);
      play.flashElapsed = -1;
    }
  }

  private finish(play: Play): void {
    if (this.current === play) this.current = null;
    play.effect.end();
    this.flash?.setEnabled(false);
    play.resolve();
  }
}
