import type { QualityTier } from "../../core/quality";
import { ACTION_LABELS, keyLabel } from "../../settings/bindings";
import type { AssignFailure } from "../../settings/bindings";
import { ACTIONS, MOUSE_SENSITIVITY_MAX, MOUSE_SENSITIVITY_MIN, RENDER_SCALES, defaultSettings } from "../../settings/settings";
import type { ActionId, QualitySetting, RenderScale } from "../../settings/settings";
import type { SettingsStore } from "../../settings/SettingsStore";
import { el } from "../dom";
import { captureNextKey } from "./KeyCapture";
import type { KeyCaptureTarget } from "./KeyCapture";
import { button, segmented, settingRow, slider, toggle } from "./widgets";

export interface SettingsPaneContext {
  settings: SettingsStore;
  /** Сенсорное устройство: клавиатурные привязки не показываем. */
  isTouch: () => boolean;
  /** Уровень качества, с которым игра запущена сейчас. */
  activeTier: () => QualityTier;
  /** Уровень, который выберет автоопределение. */
  autoTier: () => QualityTier;
  /** Уровень принудительно задан в адресе (?quality=). */
  qualityFromUrl: () => boolean;
  /** Куда вешать перехват клавиши при переназначении (обычно window). */
  keyTarget: KeyCaptureTarget;
}

type Tab = "graphics" | "controls";

const TIER_LABELS: Record<QualityTier, string> = { low: "Низкое", mid: "Среднее", high: "Высокое" };
const QUALITY_OPTIONS: ReadonlyArray<{ value: QualitySetting; label: string }> = [
  { value: "auto", label: "Авто" },
  { value: "low", label: "Низкое" },
  { value: "mid", label: "Среднее" },
  { value: "high", label: "Высокое" },
];

const FAILURE_TEXT: Record<AssignFailure, string> = {
  reserved: "Эта клавиша зарезервирована (Esc — «назад», ` — отладчик). Выбери другую.",
  "needs-key": "Эта клавиша — единственная у другого действия. Сначала назначь тому действию вторую клавишу.",
};

/**
 * Настройки: вкладки «Графика» и «Управление». Изменения применяются сразу и
 * сохраняются (SettingsStore). Панель сама перерисовывается после действий и
 * возвращает фокус на тот же элемент; ползунок перерисовку не вызывает.
 */
export class SettingsPane {
  public readonly element: HTMLElement;
  private tab: Tab = "graphics";
  private capturing: { action: ActionId; slot: 0 | 1 } | null = null;
  private cancelCapture: (() => void) | null = null;
  private message = "";

  constructor(private readonly ctx: SettingsPaneContext) {
    this.element = el("div", "pause-settings");
    this.render();
  }

  /** Идёт ли ожидание клавиши (меню в это время не должно реагировать на Esc само). */
  public get isCapturing(): boolean {
    return this.capturing !== null;
  }

  public dispose(): void {
    this.stopCapture();
  }

  /** Esc: отменяет ожидание клавиши. true — было что отменять. */
  public cancelPendingCapture(): boolean {
    if (!this.capturing) return false;
    this.stopCapture();
    this.message = "";
    this.render();
    return true;
  }

  // -------------------------------------------------------------------------

  private stopCapture(): void {
    this.cancelCapture?.();
    this.cancelCapture = null;
    this.capturing = null;
  }

  private render(): void {
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.focus;
    this.element.textContent = "";

    this.element.appendChild(el("h3", "pause-title", "Настройки"));
    this.element.appendChild(this.tabs());
    this.element.appendChild(this.tab === "graphics" ? this.graphics() : this.controls());

    const status = el("div", "pause-message", this.message);
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    this.element.appendChild(status);

    if (focused) {
      const again = (Array.from(this.element.querySelectorAll("[data-focus]")) as HTMLElement[]).find((n) => n.dataset.focus === focused);
      again?.focus();
    }
  }

  private tabs(): HTMLElement {
    const bar = el("div", "pause-tabs");
    bar.setAttribute("role", "tablist");
    const make = (tab: Tab, label: string): HTMLElement => {
      const b = el("button", `pause-tab${this.tab === tab ? " is-active" : ""}`, label);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(this.tab === tab));
      b.dataset.focus = `tab:${tab}`;
      b.addEventListener("click", () => {
        this.stopCapture();
        this.message = "";
        this.tab = tab;
        this.render();
      });
      return b;
    };
    bar.append(make("graphics", "Графика"), make("controls", "Управление"));
    return bar;
  }

  // ---- Графика -------------------------------------------------------------

  private graphics(): HTMLElement {
    const { settings } = this.ctx;
    const g = settings.get().graphics;
    const box = el("div", "pause-tabpanel");

    const pending = g.quality === "auto" ? this.ctx.autoTier() : g.quality;
    const active = this.ctx.activeTier();
    let qualityHint = `Сейчас: ${TIER_LABELS[active]}.`;
    if (this.ctx.qualityFromUrl()) qualityHint += " Уровень задан параметром ?quality= в адресе — он важнее этой настройки.";
    else if (pending !== active) qualityHint += ` Выбрано «${TIER_LABELS[pending]}» — применится при следующем запуске игры.`;
    else if (g.quality === "auto") qualityHint += " Подбирается автоматически по устройству.";

    box.append(
      settingRow(
        "Качество",
        segmented("Качество", QUALITY_OPTIONS, g.quality, (quality) => {
          settings.setGraphics({ quality });
          this.render();
        }),
        qualityHint
      ),
      settingRow(
        "Разрешение 3D",
        segmented(
          "Разрешение",
          RENDER_SCALES.map((value) => ({ value, label: `${Math.round(value * 100)}%` })),
          g.renderScale,
          (renderScale: RenderScale) => {
            settings.setGraphics({ renderScale });
            this.render();
          }
        ),
        "100% — родное разрешение экрана. Меньше — быстрее на слабых устройствах, картинка мягче. Действует сразу."
      ),
      settingRow(
        "Счётчик кадров",
        toggle("Показывать FPS", g.showFps, (showFps) => {
          settings.setGraphics({ showFps });
          this.render();
        })
      ),
      button("Сбросить графику", "pause-btn pause-btn-small", () => {
        const d = defaultSettings().graphics;
        settings.setGraphics(d);
        this.message = "Графика сброшена.";
        this.render();
      }, "reset:graphics")
    );
    return box;
  }

  // ---- Управление ----------------------------------------------------------

  private controls(): HTMLElement {
    const { settings } = this.ctx;
    const c = settings.get().controls;
    const box = el("div", "pause-tabpanel");

    box.append(
      settingRow(
        "Чувствительность камеры",
        slider({
          label: "Чувствительность камеры",
          min: MOUSE_SENSITIVITY_MIN,
          max: MOUSE_SENSITIVITY_MAX,
          step: 0.05,
          value: c.mouseSensitivity,
          format: (v) => `×${v.toFixed(2)}`,
          onInput: (v) => settings.setControls({ mouseSensitivity: v }),
        })
      ),
      settingRow(
        "Вертикаль камеры",
        toggle("Инвертировать", c.invertY, (invertY) => {
          settings.setControls({ invertY });
          this.render();
        })
      )
    );

    if (this.ctx.isTouch()) {
      box.appendChild(
        settingRow("Сенсорное управление", el("span", "pause-row-note", "стик слева · кнопки справа"), "Камера поворачивается перетаскиванием пальцем по экрану.")
      );
    } else {
      box.appendChild(this.keyTable());
    }

    box.appendChild(
      button("Сбросить управление", "pause-btn pause-btn-small", () => {
        this.stopCapture();
        settings.setControls({ mouseSensitivity: 1, invertY: false });
        settings.resetBindings();
        this.message = "Управление сброшено.";
        this.render();
      }, "reset:controls")
    );
    return box;
  }

  private keyTable(): HTMLElement {
    const bindings = this.ctx.settings.get().controls.bindings;
    const table = el("div", "pause-keys");
    table.setAttribute("role", "group");
    table.setAttribute("aria-label", "Клавиши");

    for (const action of ACTIONS) {
      const row = el("div", "pause-key-row");
      row.appendChild(el("div", "pause-key-label", ACTION_LABELS[action]));
      const slots = el("div", "pause-key-slots");
      for (const slot of [0, 1] as const) {
        const code = bindings[action][slot];
        const waiting = this.capturing?.action === action && this.capturing.slot === slot;
        const b = button(waiting ? "Нажми клавишу…" : code ? keyLabel(code) : "—", `pause-key${waiting ? " is-waiting" : ""}${code ? "" : " is-empty"}`, () => this.beginCapture(action, slot), `key:${action}:${slot}`);
        b.setAttribute("aria-label", `${ACTION_LABELS[action]}, ${slot === 0 ? "основная" : "запасная"} клавиша: ${code ? keyLabel(code) : "не назначена"}. Нажми, чтобы изменить`);
        slots.appendChild(b);
      }
      if (bindings[action][1] !== null) {
        const clear = button("✕", "pause-key-clear", () => {
          const res = this.ctx.settings.unbindKey(action, 1);
          this.message = res.ok ? "" : FAILURE_TEXT[res.reason];
          this.render();
        }, `keyclear:${action}`);
        clear.setAttribute("aria-label", `Убрать запасную клавишу: ${ACTION_LABELS[action]}`);
        slots.appendChild(clear);
      }
      row.appendChild(slots);
      table.appendChild(row);
    }
    table.appendChild(el("div", "pause-row-hint", this.capturing ? "Esc — отмена." : "Нажми на клавишу, чтобы переназначить. Esc всегда закрывает меню."));
    return table;
  }

  private beginCapture(action: ActionId, slot: 0 | 1): void {
    this.stopCapture();
    this.capturing = { action, slot };
    this.message = "";
    this.cancelCapture = captureNextKey(this.ctx.keyTarget, (code) => {
      this.cancelCapture = null;
      this.capturing = null;
      if (code === null) {
        this.message = "";
      } else {
        const res = this.ctx.settings.bindKey(action, slot, code);
        this.message = res.ok ? `${ACTION_LABELS[action]}: ${keyLabel(code)}` : FAILURE_TEXT[res.reason];
      }
      this.render();
    });
    this.render();
  }
}
