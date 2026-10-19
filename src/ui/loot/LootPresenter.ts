import { hexToRgbTriplet } from "../../core/color";
import { getQuality } from "../../core/quality";
import type { QualityProfile } from "../../core/quality";
import { el } from "../dom";
import { DEFAULT_PARCHMENT, SMALL_PARCHMENT, parchmentDataUrl } from "../parchment";
import { renderLootCard } from "./lootCards";
import type { LootItem } from "./lootItems";
import { SparkField } from "./SparkField";
import { lootPoseAt, newPose } from "./lootTimeline";
import type { LootPath, LootPhase, ScreenPoint } from "./lootTimeline";

/**
 * Презентация находок: предметы по очереди вылетают из сундука на весь экран,
 * зависают на пару секунд, а затем улетают к рюкзаку игрока.
 *
 * Любая клавиша (или касание экрана) ускоряет и завершает текущий предмет, Esc
 * пропускает все оставшиеся. Каждый предмет «долетает» ровно один раз
 * (onArrive) — даже при пропуске: рюкзак и состояние не расходятся с тем, что
 * игрок видел.
 *
 * Дёшево по построению: один оверлей, одна карточка на экране, анимация —
 * только transform/opacity (композитор, без перерасчёта вёрстки), искры — один
 * маленький канвас с ограниченным пулом. Время ведёт update(dt) из игрового цикла:
 * ускорение — просто множитель времени, анимацию легко тестировать.
 */

export interface LootRoute {
  /** Откуда вылетают (сундук на экране), CSS px. Берётся один раз при старте презентации. */
  from(): ScreenPoint;
  /** Куда улетают (рюкзак на экране). Вызывается каждый кадр полёта — рюкзак мог сдвинуться. */
  to(): ScreenPoint;
  /** Предмет долетел до рюкзака (или был пропущен). */
  onArrive?(item: LootItem): void;
}

export interface LootPresenterOptions {
  quality?: QualityProfile;
  /** Принудительно «спокойный» режим; по умолчанию — из prefers-reduced-motion. */
  reducedMotion?: boolean;
}

const ACCELERATION = 5;
const GAP_SECONDS = 0.12;
const OUTRO_SECONDS = 0.3;
const MAX_DT = 0.1;
const CALM_TIME_SCALE = 1.4;
const CARD_ASPECT = 0.72; // ширина / высота
const CARD_EM = 22; // ширина карточки в em: font-size = ширина / CARD_EM
const WARMUP_DELAY_MS = 1500;

interface ActiveItem {
  item: LootItem;
  actor: HTMLElement;
  glow: HTMLElement;
  width: number;
  height: number;
  t: number;
  speed: number;
  path: LootPath;
  tilt: number;
  phase: LootPhase;
  /** Накопленные «неродившиеся» искры (дробная часть темпа). */
  trickle: number;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

export class LootPresenter {
  private readonly quality: QualityProfile;
  private readonly calm: boolean;
  private readonly pose = newPose();

  private overlay: HTMLElement | null = null;
  private stage: HTMLElement | null = null;
  private counter: HTMLElement | null = null;
  private sparks: SparkField | null = null;

  private route: LootRoute | null = null;
  private queue: LootItem[] = [];
  private total = 0;
  private shown = 0;
  private current: ActiveItem | null = null;
  private gap = 0;
  private closing = 0;
  private warmupTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly uiRoot: HTMLElement, options: LootPresenterOptions = {}) {
    this.quality = options.quality ?? getQuality();
    this.calm = options.reducedMotion ?? prefersReducedMotion();
    // Бумагу рисуем заранее, в простое после старта: к первому сундуку она уже готова и кадр не «спотыкается».
    if (typeof setTimeout !== "undefined") {
      this.warmupTimer = setTimeout(() => {
        this.warmupTimer = null;
        parchmentDataUrl(this.parchmentSize());
      }, WARMUP_DELAY_MS);
    }
  }

  /** Идёт ли презентация (пока да — движение и меню заблокированы). */
  public get isActive(): boolean {
    return this.overlay !== null;
  }

  /** Сколько предметов ещё впереди, считая текущий. */
  public get remaining(): number {
    return this.queue.length + (this.current ? 1 : 0);
  }

  /** Запускает показ. false — если уже идёт показ или показывать нечего. */
  public present(items: readonly LootItem[], route: LootRoute): boolean {
    if (this.isActive || items.length === 0) return false;

    this.route = route;
    this.queue = [...items];
    this.total = items.length;
    this.shown = 0;
    this.gap = 0;
    this.closing = 0;
    this.buildOverlay();
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("resize", this.onResize);
    this.startNext(route.from());
    return true;
  }

  /** Раз в кадр. dt — секунды реального времени. */
  public update(dt: number): void {
    if (!this.overlay) return;
    const step = Math.min(dt, MAX_DT);
    const cur = this.current;

    if (this.closing > 0) {
      this.closing -= step;
      if (this.closing <= 0) {
        this.cleanup();
        return;
      }
    } else if (cur) {
      this.advance(cur, step);
    } else if (this.gap > 0) {
      this.gap -= step;
      if (this.gap <= 0) this.startNext(this.route!.from());
    }

    this.sparks?.update(step * (this.current?.speed ?? 1));
  }

  /** Ускоряет текущий предмет (или пропускает паузу между предметами). */
  public accelerate(): void {
    if (this.current) this.current.speed = ACCELERATION;
    else if (this.gap > 0) this.gap = 0;
  }

  /** Мгновенно завершает показ: все оставшиеся предметы «долетают» сразу. */
  public skipAll(): void {
    if (!this.overlay) return;
    const route = this.route;
    if (this.current) {
      const done = this.current.item;
      this.current = null;
      route?.onArrive?.(done);
    }
    for (const item of this.queue.splice(0)) route?.onArrive?.(item);
    this.cleanup();
  }

  public dispose(): void {
    if (this.warmupTimer !== null) {
      clearTimeout(this.warmupTimer);
      this.warmupTimer = null;
    }
    this.cleanup();
  }

  // -------------------------------------------------------------------------
  // Ввод
  // -------------------------------------------------------------------------

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return; // удержание клавиши E, которой открыли сундук, не должно пролистывать показ
    if (e.key === "Escape") this.skipAll();
    else this.accelerate();
  };

  private readonly onResize = (): void => {
    this.sparks?.resize();
    const cur = this.current;
    if (!cur) return;
    const size = this.cardSize();
    cur.width = size.width;
    cur.height = size.height;
    cur.actor.style.width = `${size.width}px`;
    cur.actor.style.height = `${size.height}px`;
    cur.actor.style.fontSize = `${size.width / CARD_EM}px`;
    cur.path.center = this.center();
    cur.path.arc = this.arc();
  };

  // -------------------------------------------------------------------------
  // Сборка и очередь
  // -------------------------------------------------------------------------

  private buildOverlay(): void {
    const overlay = el("div", "loot-overlay");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Найдено в сундуке");
    overlay.addEventListener("pointerdown", () => this.accelerate());

    overlay.appendChild(el("div", "loot-backdrop"));
    this.stage = el("div", "loot-stage");
    overlay.appendChild(this.stage);
    // Искры — ПОВЕРХ карточки (сзади их скрыла бы непрозрачная бумага); канвас не перехватывает касания.
    this.sparks = new SparkField(overlay, {
      count: this.calm ? 0 : this.quality.sparkCount,
      resolutionScale: this.quality.sparkResolutionScale,
    });
    this.counter = el("div", "loot-counter");
    this.counter.setAttribute("aria-live", "polite");
    overlay.appendChild(this.counter);
    overlay.appendChild(el("div", "loot-hint", "Любая клавиша или касание — ускорить · Esc — пропустить всё"));

    this.uiRoot.appendChild(overlay);
    this.overlay = overlay;
  }

  private startNext(from: ScreenPoint): void {
    const item = this.queue.shift();
    if (!item) {
      this.finish();
      return;
    }
    this.shown++;
    const size = this.cardSize();

    const actor = el("div", "loot-actor");
    actor.style.width = `${size.width}px`;
    actor.style.height = `${size.height}px`;
    actor.style.fontSize = `${size.width / CARD_EM}px`;
    actor.style.opacity = "0";
    const glow = el("div", "loot-glow");
    glow.style.setProperty("--accent-rgb", hexToRgbTriplet(item.accent));
    actor.appendChild(glow);
    actor.appendChild(renderLootCard(item, { parchmentUrl: parchmentDataUrl(this.parchmentSize()) }));
    this.stage!.appendChild(actor);

    this.counter!.textContent = this.total > 1 ? `Находка ${this.shown} из ${this.total}` : "Находка";
    this.sparks?.setAccent(item.accent);

    this.current = {
      item,
      actor,
      glow,
      width: size.width,
      height: size.height,
      t: 0,
      speed: this.calm ? CALM_TIME_SCALE : 1,
      path: { from: { ...from }, center: this.center(), to: { ...from }, arc: this.arc(), calm: this.calm },
      tilt: Math.sin(this.shown * 2.1) * 2.2,
      phase: "emerge",
      trickle: 0,
    };
    this.applyPose(this.current, lootPoseAt(0, this.current.path, this.current.tilt, this.pose));
  }

  private advance(cur: ActiveItem, step: number): void {
    cur.t += step * cur.speed;
    const to = this.route!.to();
    cur.path.to.x = to.x;
    cur.path.to.y = to.y;

    const pose = lootPoseAt(cur.t, cur.path, cur.tilt, this.pose);
    this.applyPose(cur, pose);
    this.emitSparks(cur, pose, step * cur.speed);
    cur.phase = pose.phase;

    if (pose.phase === "done") this.arrive(cur);
  }

  private arrive(cur: ActiveItem): void {
    cur.actor.remove();
    this.current = null;
    this.sparks?.burst(cur.path.to.x, cur.path.to.y, Math.ceil(this.quality.sparkCount / 2), 150);
    this.route?.onArrive?.(cur.item);
    if (this.queue.length === 0) this.finish();
    else this.gap = GAP_SECONDS;
  }

  /** Последний предмет долетел: оверлей плавно гаснет, искры догорают. */
  private finish(): void {
    this.closing = OUTRO_SECONDS;
    this.overlay?.classList.add("is-closing");
  }

  private cleanup(): void {
    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("resize", this.onResize);
    this.sparks?.dispose();
    this.overlay?.remove();
    this.overlay = null;
    this.stage = null;
    this.counter = null;
    this.sparks = null;
    this.current = null;
    this.queue = [];
    this.route = null;
    this.gap = 0;
    this.closing = 0;
  }

  // -------------------------------------------------------------------------
  // Вид
  // -------------------------------------------------------------------------

  private applyPose(cur: ActiveItem, pose: { x: number; y: number; scale: number; rotate: number; opacity: number; glow: number }): void {
    cur.actor.style.transform =
      `translate3d(${(pose.x - cur.width / 2).toFixed(1)}px,${(pose.y - cur.height / 2).toFixed(1)}px,0) ` +
      `rotate(${pose.rotate.toFixed(2)}deg) scale(${pose.scale.toFixed(3)})`;
    cur.actor.style.opacity = pose.opacity.toFixed(3);
    cur.glow.style.opacity = pose.glow.toFixed(3);
  }

  private emitSparks(cur: ActiveItem, pose: { phase: LootPhase; x: number; y: number; scale: number }, dt: number): void {
    const sparks = this.sparks;
    if (!sparks || !sparks.enabled) return;
    const n = this.quality.sparkCount;

    if (pose.phase === "hold" && cur.phase !== "hold") {
      sparks.ring(pose.x, pose.y, cur.width * 0.5, cur.height * 0.5, n, 280); // вспышка по контуру в момент остановки
    } else if (pose.phase === "hold") {
      cur.trickle += dt * n * 0.6;
      while (cur.trickle >= 1) {
        cur.trickle -= 1;
        // Пыльца рождается по краю карточки.
        const a = Math.random() * Math.PI * 2;
        sparks.drift(pose.x + Math.cos(a) * cur.width * 0.5, pose.y + Math.sin(a) * cur.height * 0.5, 1);
      }
    } else if (pose.phase === "fly" && pose.scale > 0.12) {
      cur.trickle += dt * n * 1.6;
      while (cur.trickle >= 1) {
        cur.trickle -= 1;
        sparks.drift(pose.x, pose.y, 1); // шлейф за улетающей карточкой
      }
    }
  }

  private cardSize(): { width: number; height: number } {
    const height = Math.max(160, Math.min(window.innerHeight * 0.78, (window.innerWidth * 0.9) / CARD_ASPECT, 720));
    return { width: height * CARD_ASPECT, height };
  }

  private center(): ScreenPoint {
    return { x: window.innerWidth / 2, y: window.innerHeight * 0.5 };
  }

  private arc(): number {
    return Math.min(140, window.innerHeight * 0.14);
  }

  private parchmentSize(): { width: number; height: number } {
    return this.quality.tier === "low" ? SMALL_PARCHMENT : DEFAULT_PARCHMENT;
  }
}
