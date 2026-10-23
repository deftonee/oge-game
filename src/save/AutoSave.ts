import type { GameState } from "../core/GameState";
import { SAVE_VERSION } from "./saveData";
import type { SavedPlayer, SavedWorld } from "./saveData";
import type { SaveStore } from "./SaveStore";

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

export interface PageEvents {
  document: Pick<Document, "addEventListener" | "removeEventListener"> & { readonly hidden: boolean };
  window: Pick<Window, "addEventListener" | "removeEventListener">;
}

export interface AutoSaveDeps {
  store: SaveStore;
  gameState: GameState;
  world: SavedWorld;
  /** Откуда начинаем (стартовая точка или позиция из сохранения): пока игрок «не записываем», сохраняется она. */
  initialPlayer: SavedPlayer;
  /** Где сейчас игрок; null — позицию сейчас записывать не надо (бой): остаётся последняя «спокойная». */
  getPlayer: () => SavedPlayer | null;
  /** Пауза между изменением прогресса и записью: серия изменений (сундук → книга → страница) пишется одним разом. */
  debounceMs?: number;
  /** Страховочная запись позиции, пока игрок просто ходит. */
  periodMs?: number;
  now?: () => number;
  timers?: Timers;
  events?: PageEvents;
}

const DEFAULT_DEBOUNCE_MS = 1500;
const DEFAULT_PERIOD_MS = 20_000;

const round2 = (n: number): number => Math.round(n * 100) / 100;

function defaultTimers(): Timers {
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (id) => globalThis.clearInterval(id as ReturnType<typeof setInterval>),
  };
}

/**
 * Автосохранение. Пишет при каждом реальном изменении прогресса (с небольшой задержкой), при
 * скрытии вкладки и закрытии страницы (на телефонах это единственный надёжный момент: вкладку
 * могут убить без предупреждения), по таймеру (позиция) и по требованию (flush — например,
 * при открытии паузы). Запись пропускается, если с прошлой ничего не изменилось.
 *
 * Меняется только `savedAt`? Это не изменение: сравниваются данные без времени.
 */
export class AutoSave {
  private readonly timers: Timers;
  private readonly events: PageEvents;
  private readonly now: () => number;
  private lastKey = "";
  private lastPlayer: SavedPlayer;
  private debounceId: unknown = null;
  private readonly intervalId: unknown;
  private readonly unsubscribe: () => void;
  private active = true;

  constructor(private readonly deps: AutoSaveDeps) {
    this.timers = deps.timers ?? defaultTimers();
    this.events = deps.events ?? { document, window };
    this.now = deps.now ?? Date.now;
    this.lastPlayer = { x: round2(deps.initialPlayer.x), z: round2(deps.initialPlayer.z) };

    this.unsubscribe = deps.gameState.subscribe(() => this.scheduleFlush());
    this.events.document.addEventListener("visibilitychange", this.onVisibility);
    this.events.window.addEventListener("pagehide", this.onPageHide);
    this.intervalId = this.timers.setInterval(() => void this.flush(), deps.periodMs ?? DEFAULT_PERIOD_MS);

    // Первая запись сразу: даже если игрок ничего не успеет сделать, перезагрузка вернёт тот же мир.
    this.flush();
  }

  /** Записывает сейчас. false — не записано (отключено или хранилище не приняло). */
  public flush(): boolean {
    if (!this.active) return false;
    this.cancelDebounce();

    const player = this.deps.getPlayer();
    if (player) this.lastPlayer = { x: round2(player.x), z: round2(player.z) };

    const payload = {
      version: SAVE_VERSION,
      world: this.deps.world,
      progress: this.deps.gameState.snapshot(),
      player: this.lastPlayer,
    };
    const key = JSON.stringify(payload);
    if (key === this.lastKey) return true;

    const ok = this.deps.store.write({ ...payload, version: SAVE_VERSION, savedAt: this.now() });
    if (ok) this.lastKey = key; // не записалось — в следующий раз попробуем снова
    return ok;
  }

  /** «Новая игра»: стереть сохранение и больше ничего не писать (иначе закрытие страницы воскресило бы его). */
  public discard(): void {
    this.teardown();
    this.deps.store.clear();
  }

  /** Конец сессии: последняя запись и отписка от всего. */
  public dispose(): void {
    this.flush();
    this.teardown();
  }

  private teardown(): void {
    this.active = false;
    this.cancelDebounce();
    this.timers.clearInterval(this.intervalId);
    this.unsubscribe();
    this.events.document.removeEventListener("visibilitychange", this.onVisibility);
    this.events.window.removeEventListener("pagehide", this.onPageHide);
  }

  private scheduleFlush(): void {
    if (!this.active || this.debounceId !== null) return;
    this.debounceId = this.timers.setTimeout(() => {
      this.debounceId = null;
      this.flush();
    }, this.deps.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }

  private cancelDebounce(): void {
    if (this.debounceId === null) return;
    this.timers.clearTimeout(this.debounceId);
    this.debounceId = null;
  }

  private readonly onVisibility = (): void => {
    if (this.events.document.hidden) this.flush();
  };

  private readonly onPageHide = (): void => {
    this.flush();
  };
}
