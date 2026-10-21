import { defaultSettings, sanitizeSettings } from "./settings";
import type { Settings } from "./settings";

/** Ключ в localStorage; версия в имени — при несовместимой смене формата старые данные просто не подхватятся. */
export const SETTINGS_KEY = "oge.settings.v1";

/** Всё, что нужно от хранилища (подходит localStorage и подмена в тестах). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage бывает недоступен (приватный режим, запрет cookies) и бросает на самом обращении — тогда работаем «в памяти». */
export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadSettings(storage: KeyValueStorage | null = browserStorage()): Settings {
  if (!storage) return defaultSettings();
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : defaultSettings();
  } catch {
    return defaultSettings(); // битый JSON или запрещённое чтение
  }
}

/** false — сохранить не удалось (квота, запрет); игра продолжает работать с настройками в памяти. */
export function saveSettings(settings: Settings, storage: KeyValueStorage | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
