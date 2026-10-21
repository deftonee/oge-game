import type { SettingsStore } from "../settings/SettingsStore";
import type { ActionId, KeyPair } from "../settings/settings";

/**
 * Клавиатурный ввод по ДЕЙСТВИЯМ, а не по клавишам: игра спрашивает «нажата ли
 * "вперёд"», а какие клавиши за это отвечают, решают настройки игрока. Клавиши —
 * KeyboardEvent.code, поэтому раскладка не важна (при русской «ц» это всё та же KeyW).
 *
 * Один глобальный слушатель на всю игру вместо отдельных у игрока и у меню.
 * Потеря фокуса окном сбрасывает все нажатия — иначе зажатая при Alt-Tab клавиша
 * «залипала» бы и персонаж шёл сам.
 */
export class KeyBindings {
  private readonly down = new Set<string>();

  constructor(
    private readonly store: SettingsStore,
    private readonly target: Pick<Window, "addEventListener" | "removeEventListener"> = window
  ) {
    target.addEventListener("keydown", this.onKeyDown);
    target.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("blur", this.onBlur);
  }

  /** Клавиши действия (основная, запасная) по текущим настройкам. */
  public keys(action: ActionId): Readonly<KeyPair> {
    return this.store.get().controls.bindings[action];
  }

  /** Зажата ли хоть одна клавиша действия. */
  public isDown(action: ActionId): boolean {
    const [primary, secondary] = this.keys(action);
    return (primary !== null && this.down.has(primary)) || (secondary !== null && this.down.has(secondary));
  }

  /** Относится ли событие клавиши к действию (для «нажатий», а не «удержаний»). */
  public matches(action: ActionId, event: { code: string }): boolean {
    const [primary, secondary] = this.keys(action);
    return event.code !== "" && (event.code === primary || event.code === secondary);
  }

  /** Забыть все нажатия (при открытии меню, потере фокуса). */
  public clearPressed(): void {
    this.down.clear();
  }

  public dispose(): void {
    this.target.removeEventListener("keydown", this.onKeyDown);
    this.target.removeEventListener("keyup", this.onKeyUp);
    this.target.removeEventListener("blur", this.onBlur);
    this.down.clear();
  }

  private readonly onKeyDown = (e: Event): void => {
    const code = (e as KeyboardEvent).code;
    if (code) this.down.add(code);
  };

  private readonly onKeyUp = (e: Event): void => {
    const code = (e as KeyboardEvent).code;
    if (code) this.down.delete(code);
  };

  private readonly onBlur = (): void => {
    this.down.clear();
  };
}
