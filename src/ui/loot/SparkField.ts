import { shadeHex } from "../../core/color";
import { el } from "../dom";

/**
 * Искры вокруг находки: один небольшой канвас на весь оверлей и жёстко
 * ограниченный пул частиц (память и время кадра не растут, как бы ни
 * «сыпал» эффект). Рисуются заранее подготовленные мягкие спрайты с режимом
 * «lighter» — это свечение без фильтров и теней. Канвас рендерится в уменьшенном
 * разрешении (искры и так размытые) — на слабых устройствах это в разы дешевле.
 *
 * Без 2D-контекста (старые окружения, тесты) или с count = 0 — тихая заглушка.
 */

const SPRITE_SIZE = 32;
const MAX_DT = 0.05;

type Sprite = HTMLCanvasElement;

function makeSprite(rgb: [number, number, number]): Sprite | null {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SPRITE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const r = SPRITE_SIZE / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, `rgba(255,255,255,1)`);
  grad.addColorStop(0.25, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.9)`);
  grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  return canvas;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export interface SparkFieldOptions {
  /** Размер одной «пачки» искр; пул вмещает не больше count × POOL_FACTOR частиц. 0 — искр нет. */
  count: number;
  /** Масштаб разрешения канваса относительно экрана (0…1]. */
  resolutionScale: number;
}

const POOL_FACTOR = 4;
/** Индексы спрайтов: тёплое золото, почти белый, цвет акцента. */
const GOLD = 0;
const WHITE = 1;
const ACCENT = 2;

export class SparkField {
  /** Канвас для вставки в DOM; null, если искры выключены или контекста нет. */
  public readonly canvas: HTMLCanvasElement | null;

  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly capacity: number;
  private readonly burstSize: number;
  private readonly scale: number;
  private sprites: (Sprite | null)[] = [];

  // Пул частиц в плоских типизированных массивах: ни одной аллокации в кадре.
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly kind: Uint8Array;
  private alive = 0;
  private dirty = false;

  constructor(parent: HTMLElement, options: SparkFieldOptions) {
    this.burstSize = Math.max(0, Math.floor(options.count));
    this.scale = Math.max(0.25, Math.min(1, options.resolutionScale));
    this.capacity = this.burstSize * POOL_FACTOR;

    let ctx: CanvasRenderingContext2D | null = null;
    let canvas: HTMLCanvasElement | null = null;
    if (this.burstSize > 0) {
      canvas = el("canvas", "loot-sparks");
      ctx = canvas.getContext("2d");
      if (!ctx) canvas = null;
    }
    this.canvas = canvas;
    this.ctx = ctx;

    const n = this.canvas ? this.capacity : 0;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.size = new Float32Array(n);
    this.kind = new Uint8Array(n);

    if (this.canvas) {
      parent.appendChild(this.canvas);
      this.sprites = [makeSprite([255, 214, 120]), makeSprite([255, 246, 224]), makeSprite([255, 214, 120])];
      this.resize();
    }
  }

  public get enabled(): boolean {
    return this.canvas !== null;
  }

  /** Сколько частиц живо прямо сейчас (для тестов и бюджета). */
  public get liveCount(): number {
    return this.alive;
  }

  public get poolCapacity(): number {
    return this.canvas ? this.capacity : 0;
  }

  public resize(): void {
    if (!this.canvas) return;
    this.canvas.width = Math.max(1, Math.round(window.innerWidth * this.scale));
    this.canvas.height = Math.max(1, Math.round(window.innerHeight * this.scale));
  }

  /** Подкрашивает «акцентные» искры в цвет текущей находки. */
  public setAccent(hex: string): void {
    if (!this.canvas) return;
    this.sprites[ACCENT] = makeSprite(hexToRgb(shadeHex(hex, 1.15)));
  }

  /** Вспышка: искры разлетаются во все стороны из точки (x, y) (CSS px). */
  public burst(x: number, y: number, n: number = this.burstSize, speed = 220): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.65);
      this.spawn(x, y, Math.cos(a) * v, Math.sin(a) * v, 0.5 + Math.random() * 0.7, 3 + Math.random() * 5);
    }
  }

  /** Вспышка по контуру эллипса (rx × ry) вокруг (cx, cy): искры разлетаются наружу, как от карточки. */
  public ring(cx: number, cy: number, rx: number, ry: number, n: number = this.burstSize, speed = 240): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const v = speed * (0.3 + Math.random() * 0.7);
      this.spawn(cx + dx * rx, cy + dy * ry, dx * v, dy * v, 0.6 + Math.random() * 0.8, 3 + Math.random() * 5);
    }
  }

  /** Искры, лениво плывущие вверх, — «пыльца» вокруг карточки. */
  public drift(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.spawn(x, y, (Math.random() - 0.5) * 50, -20 - Math.random() * 50, 0.9 + Math.random() * 0.9, 2 + Math.random() * 3.5);
    }
  }

  /** Шаг физики и отрисовка. dt — секунды (ускорение презентации ускоряет и искры). */
  public update(dt: number): void {
    if (!this.canvas || !this.ctx) return;
    const step = Math.min(dt, MAX_DT);
    const ctx = this.ctx;

    if (this.alive === 0) {
      if (this.dirty) {
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.dirty = false;
      }
      return;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    const drag = Math.exp(-1.6 * step);

    let i = 0;
    while (i < this.alive) {
      this.life[i] -= step;
      if (this.life[i] <= 0) {
        this.removeAt(i); // на место удалённой встаёт последняя — индекс не двигаем
        continue;
      }
      this.vx[i] *= drag;
      this.vy[i] = this.vy[i] * drag - 30 * step; // лёгкий подъём: тёплый воздух
      this.px[i] += this.vx[i] * step;
      this.py[i] += this.vy[i] * step;

      const t = this.life[i] / this.maxLife[i];
      const sprite = this.sprites[this.kind[i]];
      if (sprite) {
        const s = this.size[i] * (0.5 + 0.5 * t) * 3.2;
        ctx.globalAlpha = Math.min(1, t * 1.6);
        ctx.drawImage(sprite, this.px[i] - s / 2, this.py[i] - s / 2, s, s);
      }
      i++;
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    this.dirty = true;
  }

  public clear(): void {
    this.alive = 0;
    if (this.canvas && this.ctx) {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.dirty = false;
  }

  public dispose(): void {
    this.clear();
    this.canvas?.remove();
  }

  // -------------------------------------------------------------------------

  private spawn(x: number, y: number, vx: number, vy: number, life: number, size: number): void {
    if (!this.canvas || this.alive >= this.capacity) return; // пул полон — лишние искры просто не рождаются
    const i = this.alive++;
    this.px[i] = x;
    this.py[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = this.maxLife[i] = life;
    this.size[i] = size;
    const r = Math.random();
    this.kind[i] = r < 0.45 ? GOLD : r < 0.7 ? WHITE : ACCENT;
  }

  private removeAt(i: number): void {
    const last = --this.alive;
    if (i === last) return;
    this.px[i] = this.px[last];
    this.py[i] = this.py[last];
    this.vx[i] = this.vx[last];
    this.vy[i] = this.vy[last];
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.size[i] = this.size[last];
    this.kind[i] = this.kind[last];
  }
}
