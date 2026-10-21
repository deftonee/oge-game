import { ACTIONS, clampSensitivity, defaultSettings, sanitizeSettings } from "./settings";
import type { ActionId, ControlSettings, GraphicsSettings, Settings } from "./settings";
import { assignKey, clearKey, resetBindings } from "./bindings";
import type { AssignResult } from "./bindings";
import { browserStorage, loadSettings, saveSettings } from "./settingsStorage";
import type { KeyValueStorage } from "./settingsStorage";

export type SettingsListener = (settings: Readonly<Settings>) => void;

/**
 * Единственный владелец настроек: хранит их в памяти, сохраняет при каждом
 * изменении и сообщает подписчикам (камера, движок, подсказки, меню). Подписчик
 * получает уже применённое состояние — читать из хранилища самому не нужно.
 */
export class SettingsStore {
  private settings: Settings;
  private readonly listeners = new Set<SettingsListener>();

  constructor(private readonly storage: KeyValueStorage | null = browserStorage()) {
    this.settings = loadSettings(storage);
  }

  public get(): Readonly<Settings> {
    return this.settings;
  }

  public subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public setGraphics(patch: Partial<GraphicsSettings>): void {
    this.commit({ ...this.settings, graphics: { ...this.settings.graphics, ...patch } });
  }

  public setControls(patch: Partial<Omit<ControlSettings, "bindings">>): void {
    const controls = { ...this.settings.controls, ...patch };
    controls.mouseSensitivity = clampSensitivity(controls.mouseSensitivity);
    this.commit({ ...this.settings, controls });
  }

  /** Назначает клавишу; при отказе (резерв, «последняя клавиша») настройки не меняются. */
  public bindKey(action: ActionId, slot: 0 | 1, code: string): AssignResult {
    const result = assignKey(this.settings.controls.bindings, action, slot, code);
    if (result.ok) this.commit({ ...this.settings, controls: { ...this.settings.controls, bindings: result.bindings } });
    return result;
  }

  public unbindKey(action: ActionId, slot: 0 | 1): AssignResult {
    const result = clearKey(this.settings.controls.bindings, action, slot);
    if (result.ok) this.commit({ ...this.settings, controls: { ...this.settings.controls, bindings: result.bindings } });
    return result;
  }

  public resetBindings(): void {
    this.commit({ ...this.settings, controls: { ...this.settings.controls, bindings: resetBindings() } });
  }

  public resetAll(): void {
    this.commit(defaultSettings());
  }

  private commit(next: Settings): void {
    // Прогон через sanitize — единый барьер: в памяти никогда не окажется невалидных настроек.
    this.settings = sanitizeSettings(next);
    saveSettings(this.settings, this.storage);
    for (const l of [...this.listeners]) l(this.settings);
  }
}

/** Все действия, у которых есть хотя бы одна клавиша (для проверок и подсказок). */
export function boundActions(settings: Readonly<Settings>): ActionId[] {
  return ACTIONS.filter((a) => settings.controls.bindings[a][0] !== null);
}
