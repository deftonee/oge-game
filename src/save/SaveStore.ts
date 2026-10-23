import type { KeyValueStorage } from "../settings/settingsStorage";
import { parseSave } from "./saveData";
import type { GameSave } from "./saveData";

/** Ключ в localStorage; версия в имени — как у настроек. */
export const SAVE_KEY = "oge.save.v1";

export interface SaveStorage extends KeyValueStorage {
  removeItem(key: string): void;
}

/** localStorage бывает недоступен (приватный режим, запрет cookies) и бросает на самом обращении. */
export function browserSaveStorage(): SaveStorage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Чтение и запись сохранения. Ничего не бросает: нет хранилища, квота, битый JSON — игра
 * продолжает работать, просто без сохранений (см. `available`).
 */
export class SaveStore {
  private writeFailed = false;

  constructor(private readonly storage: SaveStorage | null = browserSaveStorage()) {}

  /** Можно ли рассчитывать, что прогресс сохраняется: хранилище есть и последняя запись удалась. */
  public get available(): boolean {
    return this.storage !== null && !this.writeFailed;
  }

  /** Сохранение или null: нет, испорчено или от другой версии. */
  public load(): GameSave | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(SAVE_KEY);
      return raw ? parseSave(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  public write(save: GameSave): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(save));
      this.writeFailed = false;
      return true;
    } catch {
      this.writeFailed = true;
      return false;
    }
  }

  public clear(): void {
    try {
      this.storage?.removeItem(SAVE_KEY);
    } catch {
      // стирать нечего или нельзя — новая игра всё равно создаст новое сохранение поверх
    }
  }
}
