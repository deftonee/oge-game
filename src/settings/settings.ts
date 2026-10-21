import type { QualityTier } from "../core/quality";

/**
 * Модель настроек игрока: графика и управление. Чистые данные и валидация, без
 * DOM и хранилища — поэтому легко тестируется, а испорченные/устаревшие данные из
 * localStorage никогда не ломают игру: всё, что не прошло проверку, молча
 * заменяется значением по умолчанию.
 */

export type QualitySetting = "auto" | QualityTier;
/** Доля от родного разрешения экрана, в которой рисуется 3D (меньше → легче видеокарте). */
export type RenderScale = 0.5 | 0.75 | 1;

export const RENDER_SCALES: readonly RenderScale[] = [0.5, 0.75, 1];
export const QUALITY_SETTINGS: readonly QualitySetting[] = ["auto", "low", "mid", "high"];

/** Действия, которые можно переназначить. Порядок — порядок в меню. */
export const ACTIONS = ["moveForward", "moveBack", "moveLeft", "moveRight", "interact", "spellGraph", "pause"] as const;
export type ActionId = (typeof ACTIONS)[number];

/** Клавиша — KeyboardEvent.code (не зависит от раскладки: «W» работает и при русской «ц»). null — слот пуст. */
export type KeySlot = string | null;
/** Основная и запасная клавиша действия. Основная всегда задана. */
export type KeyPair = [KeySlot, KeySlot];
export type Bindings = Record<ActionId, KeyPair>;

export const DEFAULT_BINDINGS: Readonly<Record<ActionId, readonly [string, string | null]>> = {
  moveForward: ["KeyW", "ArrowUp"],
  moveBack: ["KeyS", "ArrowDown"],
  moveLeft: ["KeyA", "ArrowLeft"],
  moveRight: ["KeyD", "ArrowRight"],
  interact: ["KeyE", null],
  spellGraph: ["KeyG", null],
  pause: ["Escape", "KeyP"],
};

export const MOUSE_SENSITIVITY_MIN = 0.3;
export const MOUSE_SENSITIVITY_MAX = 3;

export interface GraphicsSettings {
  quality: QualitySetting;
  renderScale: RenderScale;
  showFps: boolean;
}

export interface ControlSettings {
  bindings: Bindings;
  /** Множитель скорости поворота камеры (1 — как раньше). */
  mouseSensitivity: number;
  invertY: boolean;
}

export interface Settings {
  version: 1;
  graphics: GraphicsSettings;
  controls: ControlSettings;
}

export function defaultBindings(): Bindings {
  const out = {} as Bindings;
  for (const action of ACTIONS) out[action] = [...DEFAULT_BINDINGS[action]] as KeyPair;
  return out;
}

export function defaultSettings(): Settings {
  return {
    version: 1,
    graphics: { quality: "auto", renderScale: 1, showFps: false },
    controls: { bindings: defaultBindings(), mouseSensitivity: 1, invertY: false },
  };
}

// ---------------------------------------------------------------------------
// Валидация
// ---------------------------------------------------------------------------

const KEY_CODE = /^[A-Za-z0-9]{1,20}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validCode(v: unknown): string | null {
  return typeof v === "string" && KEY_CODE.test(v) ? v : null;
}

export function clampSensitivity(v: number): number {
  return Math.round(Math.min(MOUSE_SENSITIVITY_MAX, Math.max(MOUSE_SENSITIVITY_MIN, v)) * 100) / 100;
}

function sanitizeBindings(raw: unknown): Bindings {
  const defaults = defaultBindings();
  if (!isRecord(raw)) return defaults;

  const used = new Set<string>();
  const out = {} as Bindings;
  for (const action of ACTIONS) {
    const stored = Array.isArray(raw[action]) ? (raw[action] as unknown[]) : [];
    // Клавиша, уже занятая более ранним действием, отбрасывается (защита от ручной правки хранилища).
    const take = (v: unknown): string | null => {
      const code = validCode(v);
      if (!code || used.has(code)) return null;
      used.add(code);
      return code;
    };
    const primary = take(stored[0]);
    const secondary = take(stored[1]);
    out[action] = primary ? [primary, secondary] : secondary ? [secondary, null] : [...defaults[action]];
  }
  return out;
}

/** Приводит что угодно (из localStorage, из будущей версии игры) к корректным настройкам. */
export function sanitizeSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (!isRecord(raw)) return base;

  const g = isRecord(raw.graphics) ? raw.graphics : {};
  const c = isRecord(raw.controls) ? raw.controls : {};

  return {
    version: 1,
    graphics: {
      quality: QUALITY_SETTINGS.includes(g.quality as QualitySetting) ? (g.quality as QualitySetting) : base.graphics.quality,
      renderScale: RENDER_SCALES.includes(g.renderScale as RenderScale) ? (g.renderScale as RenderScale) : base.graphics.renderScale,
      showFps: typeof g.showFps === "boolean" ? g.showFps : base.graphics.showFps,
    },
    controls: {
      bindings: sanitizeBindings(c.bindings),
      mouseSensitivity: typeof c.mouseSensitivity === "number" && Number.isFinite(c.mouseSensitivity) ? clampSensitivity(c.mouseSensitivity) : 1,
      invertY: typeof c.invertY === "boolean" ? c.invertY : false,
    },
  };
}
