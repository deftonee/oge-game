import { Ray, Vector3, type Scene } from "@babylonjs/core";
import { bushCoversPlayer, findHidingBush, type BushVolume } from "./bushes";
import { EYE_HEIGHT, isSightBlocked, type TreeVolume } from "./cover";
import type { PlayerController } from "../core/PlayerController";
import type { WorldStreamer } from "../world/WorldStreamer";

/** Прозрачность куста/зарослей, внутри которых стоит игрок (чтобы игрока было видно сквозь крону). */
const BUSH_ALPHA_WITH_PLAYER = 0.3;
/** Прозрачность кроны дерева, когда она между камерой и игроком. */
const TREE_ALPHA_OCCLUDING = 0.3;
/** Прозрачность игрока в укрытии — лёгкий намёк «ты невидим». */
const PLAYER_ALPHA_HIDDEN = 0.6;
/** Скорость сглаживания прозрачности, 1/с. */
const FADE_RATE = 7;
/** Стены, которые перекрывают обзор (барьеры-ворота обзор не закрывают). */
const WALL_NAME = /^(walls_|wallBox_)/;
/** Точка на игроке, в которую целится камера при проверке «крона закрывает героя» (м над центром коллайдера). */
const PLAYER_FOCUS_LIFT = 0.5;

/**
 * Стелс: определяет, спрятан ли игрок в кусте/зарослях, плавно меняет прозрачность
 * кустов, крон деревьев и игрока и каждый кадр «думает» за всех активных ведьм
 * (см. Witch.updateAi). Обзор ведьм перекрывают стены (луч по мешам), а также кусты,
 * заросли и деревья (круги на уровне глаз — см. cover.ts).
 */
export class StealthManager {
  private hidden = false;
  private playerAlpha = 1;
  private readonly ray = new Ray(Vector3.Zero(), Vector3.Forward(), 1);
  private readonly rayOrigin = new Vector3();
  private readonly rayDir = new Vector3();

  // Укрытия текущего кадра — по ним считается и прозрачность, и линия взгляда.
  private bushes: BushVolume[] = [];
  private trees: TreeVolume[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly player: PlayerController,
    private readonly streamer: WorldStreamer
  ) {}

  /** Спрятан ли игрок в кусте прямо сейчас (ведьмы его не видят). */
  public get isHidden(): boolean {
    return this.hidden;
  }

  public update(dt: number, menuOpen: boolean): void {
    const px = this.player.position.x;
    const pz = this.player.position.z;

    this.bushes = this.streamer.getActiveBushes();
    this.trees = this.streamer.getActiveTrees();
    this.hidden = findHidingBush(this.bushes, px, pz) !== null;

    this.fadeBushes(dt, px, pz);
    this.fadeTrees(dt);
    this.fadePlayer(dt);

    // Секция игрока: ведьма не покидает свою — за границей её погоня превращается в наблюдение.
    const section = this.streamer.sectionAt(px, pz);
    const playerSectionIndex = section >= 0 ? section : undefined;

    const lineOfSight = (fx: number, fz: number, tx: number, tz: number) => this.hasLineOfSight(fx, fz, tx, tz);
    for (const witch of this.streamer.getActiveWitches()) {
      witch.updateAi(dt, {
        playerX: px,
        playerZ: pz,
        playerHidden: this.hidden,
        playerSectionIndex,
        paused: menuOpen,
        lineOfSight,
      });
    }
  }

  /** Все кусты/заросли, чья крона накрывает игрока, становятся полупрозрачными (соседние заросли перекрываются). */
  private fadeBushes(dt: number, px: number, pz: number): void {
    const k = Math.min(1, dt * FADE_RATE);
    for (const b of this.bushes) {
      const target = bushCoversPlayer(b, px, pz) ? BUSH_ALPHA_WITH_PLAYER : 1;
      if (b.alpha === target) continue;
      b.alpha += (target - b.alpha) * k;
      if (Math.abs(b.alpha - target) < 0.01) b.alpha = target;
      b.setAlpha(b.alpha);
    }
  }

  /** Крона между камерой и игроком — прозрачная, иначе высокое дерево закрыло бы героя от зрителя. */
  private fadeTrees(dt: number): void {
    const camera = this.scene.activeCamera;
    const k = Math.min(1, dt * FADE_RATE);
    const pp = this.player.position;
    for (const t of this.trees) {
      const occluding = camera ? segmentHitsSphere(camera.globalPosition, pp.x, pp.y + PLAYER_FOCUS_LIFT, pp.z, t) : false;
      const target = occluding ? TREE_ALPHA_OCCLUDING : 1;
      if (t.alpha === target) continue;
      t.alpha += (target - t.alpha) * k;
      if (Math.abs(t.alpha - target) < 0.01) t.alpha = target;
      t.canopy.visibility = t.alpha;
    }
  }

  private fadePlayer(dt: number): void {
    const target = this.hidden ? PLAYER_ALPHA_HIDDEN : 1;
    if (this.playerAlpha === target) return;
    const k = Math.min(1, dt * FADE_RATE);
    this.playerAlpha += (target - this.playerAlpha) * k;
    if (Math.abs(this.playerAlpha - target) < 0.01) this.playerAlpha = target;
    this.player.setVisualAlpha(this.playerAlpha);
  }

  /**
   * Линия взгляда ведьма → игрок свободна, если её не перекрывают ни кусты/заросли/деревья
   * (дешёвая проверка кругов), ни стены (луч по мешам стен на высоте глаз).
   */
  private hasLineOfSight(fx: number, fz: number, tx: number, tz: number): boolean {
    if (isSightBlocked(fx, fz, tx, tz, [this.bushes, this.trees])) return false;

    const dx = tx - fx;
    const dz = tz - fz;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return true;
    this.rayOrigin.set(fx, EYE_HEIGHT, fz);
    this.rayDir.set(dx / len, 0, dz / len);
    this.ray.origin.copyFrom(this.rayOrigin);
    this.ray.direction.copyFrom(this.rayDir);
    this.ray.length = len;
    const hit = this.scene.pickWithRay(this.ray, (m) => m.checkCollisions && WALL_NAME.test(m.name));
    return !hit?.hit;
  }
}

/** Пересекает ли отрезок камера → (tx,ty,tz) крону дерева (сферу). */
function segmentHitsSphere(from: Vector3, tx: number, ty: number, tz: number, t: TreeVolume): boolean {
  const dx = tx - from.x;
  const dy = ty - from.y;
  const dz = tz - from.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1e-9) return false;
  // Ближайшая к центру кроны точка отрезка.
  const cx = t.x - from.x;
  const cy = t.canopyY - from.y;
  const cz = t.z - from.z;
  const u = Math.max(0, Math.min(1, (cx * dx + cy * dy + cz * dz) / len2));
  const ex = from.x + dx * u - t.x;
  const ey = from.y + dy * u - t.canopyY;
  const ez = from.z + dz * u - t.z;
  return ex * ex + ey * ey + ez * ez <= t.canopyRadius * t.canopyRadius;
}
