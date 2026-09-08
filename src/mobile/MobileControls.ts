/**
 * Мобильное управление поверх канваса:
 * - слева — виртуальный стик (зона касания = левая часть экрана; база появляется
 *   в точке касания, вектор нормирован: y=+1 вперёд/вверх, x=+1 вправо);
 * - справа — круглая кнопка «взаимодействие» (аналог E) и кнопка графа заклинаний (G).
 *
 * Монтируется лениво при первом touchstart — на десктопе ничего не создаётся.
 * Pointer Events + setPointerCapture: палец можно таскать за пределы зоны, стик не теряется.
 */
export interface MobileControlsOptions {
  /** Аналог клавиши E — взаимодействие с ближайшим объектом. */
  onInteract: () => void;
  /** Аналог клавиши G — открыть граф заклинаний. */
  onSpellGraph: () => void;
  /** Принудительно включить управление сразу (эмуляция мобильного на десктопе, ?mobile=1). */
  force?: boolean;
}

const STICK_RADIUS = 56; // px — предел хода ручки
const STICK_DEADZONE = 0.14; // нормированный мёртвый ход (возврат нуля)

export class MobileControls {
  private controlsRoot: HTMLElement | null = null;
  private joyZone: HTMLElement | null = null;
  private joyBase: HTMLElement | null = null;
  private joyKnob: HTMLElement | null = null;

  private mounted = false;
  private visible = true;

  // Состояние стика
  private active = false;
  private pointerId = -1;
  private originX = 0;
  private originY = 0;
  private axisX = 0; // нормированный вектор (-1..1)
  private axisY = 0;

  constructor(private readonly opts: MobileControlsOptions) {
    // Основное тач-устройство — монтируем сразу (стик готов к первому касанию).
    // Гибриды (тач-ноутбук) — ждём первый touchstart, чтобы не показывать
    // мобильные кнопки при мышке. force перекрывает всё: эмуляция с компа.
    const coarsePrimary = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    if (this.opts.force === true || coarsePrimary) {
      this.mount();
    } else {
      window.addEventListener("touchstart", () => this.mount(), { once: true, passive: true });
    }
  }

  public get isActive(): boolean {
    return this.mounted;
  }

  /** Нормированный вектор стика; мёртвый ход и неактивное состояние возвращают ноль. */
  public getMoveVector(): { x: number; y: number } {
    if (!this.active) return MobileControls.ZERO;
    if (Math.hypot(this.axisX, this.axisY) < STICK_DEADZONE) return MobileControls.ZERO;
    return { x: this.axisX, y: this.axisY };
  }

  /** Скрыть/показать управление (например, когда открыто меню). */
  public setVisible(visible: boolean): void {
    if (!this.mounted || this.visible === visible) return;
    this.visible = visible;
    this.controlsRoot!.style.display = visible ? "block" : "none";
    if (!visible) this.resetStick();
  }

  private mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    document.body.classList.add("is-mobile");

    const root = document.createElement("div");
    root.className = "mobile-controls";

    // --- Зона стика ---
    const zone = document.createElement("div");
    zone.className = "joy-zone";

    const base = document.createElement("div");
    base.className = "joy-base";
    const knob = document.createElement("div");
    knob.className = "joy-knob";
    base.appendChild(knob);
    zone.appendChild(base);

    // --- Кнопки справа ---
    const btnRight = document.createElement("div");
    btnRight.className = "mobile-buttons";

    const interact = document.createElement("button");
    interact.type = "button";
    interact.className = "mobile-btn interact";
    interact.setAttribute("aria-label", "Взаимодействие (E)");
    interact.textContent = "✋";

    const graph = document.createElement("button");
    graph.type = "button";
    graph.className = "mobile-btn graph";
    graph.setAttribute("aria-label", "Граф заклинаний (G)");
    graph.textContent = "📜";

    btnRight.append(graph, interact);
    root.append(zone, btnRight);
    document.body.appendChild(root);

    this.controlsRoot = root;
    this.joyZone = zone;
    this.joyBase = base;
    this.joyKnob = knob;

    this.wireJoystick(zone, base, knob);
    this.wireButton(interact, this.opts.onInteract);
    this.wireButton(graph, this.opts.onSpellGraph);
  }

  private wireJoystick(zone: HTMLElement, base: HTMLElement, knob: HTMLElement): void {
    zone.addEventListener("pointerdown", (e) => {
      if (this.active) return; // стик держит только первый палец
      e.preventDefault();
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {
        /* устаревшие браузеры без capture — работаем по координатам */
      }
      this.active = true;
      this.pointerId = e.pointerId;
      this.originX = e.clientX;
      this.originY = e.clientY;
      this.axisX = 0;
      this.axisY = 0;
      base.style.opacity = "1";
      base.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      knob.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    });

    zone.addEventListener("pointermove", (e) => {
      if (!this.active || e.pointerId !== this.pointerId) return;
      e.preventDefault();
      let dx = e.clientX - this.originX;
      let dy = e.clientY - this.originY;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        dx = (dx / len) * STICK_RADIUS;
        dy = (dy / len) * STICK_RADIUS;
      }
      this.axisX = dx / STICK_RADIUS;
      this.axisY = -dy / STICK_RADIUS; // DOM-y растёт вниз: вверх по экрану = вперёд (+y)
      knob.style.transform = `translate(${this.originX + dx}px, ${this.originY + dy}px)`;
    });

    const release = (e: PointerEvent) => {
      if (!this.active || e.pointerId !== this.pointerId) return;
      this.resetStick();
    };
    zone.addEventListener("pointerup", release);
    zone.addEventListener("pointercancel", release);
    zone.addEventListener("lostpointercapture", release);
  }

  private wireButton(btn: HTMLButtonElement, fn: () => void): void {
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      fn();
    });
  }

  private resetStick(): void {
    this.active = false;
    this.pointerId = -1;
    this.axisX = 0;
    this.axisY = 0;
    if (this.joyBase) this.joyBase.style.opacity = "0";
  }

  private static readonly ZERO = { x: 0, y: 0 };
}