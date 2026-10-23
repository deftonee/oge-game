import type { GameState } from "../../core/GameState";
import type { QualityTier } from "../../core/quality";
import type { SettingsStore } from "../../settings/SettingsStore";
import { el } from "../dom";
import { renderInventory } from "./inventoryPane";
import { SettingsPane } from "./SettingsPane";
import type { KeyCaptureTarget } from "./KeyCapture";
import { button } from "./widgets";

export interface PauseMenuDeps {
  gameState: GameState;
  settings: SettingsStore;
  /** «Новая игра»: подтверждено в диалоге. Вызывающий стирает сохранение и перезапускает игру. */
  onNewGame: () => void;
  /** Сохраняется ли прогресс (false — хранилище недоступно; меню честно об этом пишет). */
  canSave: () => boolean;
  /** Относится ли клавиша к действию «пауза» (по настройкам игрока). */
  isPauseKey: (e: KeyboardEvent) => boolean;
  isTouch: () => boolean;
  activeTier: () => QualityTier;
  autoTier: () => QualityTier;
  qualityFromUrl: () => boolean;
  /** Окно, на которое вешаются перехватчики клавиш. */
  keyTarget?: KeyCaptureTarget & Pick<Window, "addEventListener" | "removeEventListener">;
  onOpen?: () => void;
  onClose?: () => void;
}

type View = "inventory" | "settings" | "new-game";

const MENU: ReadonlyArray<{ view: View | "resume"; icon: string; label: string; cls: string }> = [
  { view: "resume", icon: "▶", label: "Продолжить", cls: "is-primary" },
  { view: "inventory", icon: "🎒", label: "Инвентарь", cls: "" },
  { view: "settings", icon: "⚙", label: "Настройки", cls: "" },
  { view: "new-game", icon: "↻", label: "Новая игра", cls: "is-danger" },
];

/**
 * Меню паузы: слева — «Продолжить / Инвентарь / Настройки / Новая игра», справа —
 * содержимое выбранного раздела (по умолчанию — инвентарь с деревом изученных
 * заклинаний). Пока меню открыто, игра стоит (см. Game.startRenderLoop), а любые
 * клавиши, кроме управления самим меню, до игры не доходят.
 *
 * Прогресс сохраняется автоматически (см. AutoSave), поэтому «выхода» нет — перезагрузка
 * страницы просто продолжила бы игру; вместо него «Новая игра» с подтверждением.
 *
 * Esc — «назад»: из настроек и подтверждения возвращает в инвентарь, из
 * инвентаря — продолжает игру. Клавиша паузы по настройкам игрока (например P)
 * продолжает игру из любого раздела.
 */
export class PauseMenu {
  private overlay: HTMLElement | null = null;
  private content: HTMLElement | null = null;
  private menu: HTMLElement | null = null;
  private settingsPane: SettingsPane | null = null;
  private view: View = "inventory";
  private readonly keyTarget: NonNullable<PauseMenuDeps["keyTarget"]>;

  constructor(private readonly uiRoot: HTMLElement, private readonly deps: PauseMenuDeps) {
    this.keyTarget = deps.keyTarget ?? window;
  }

  public get isOpen(): boolean {
    return this.overlay !== null;
  }

  /** Открывает паузу. false — уже открыта. */
  public open(): boolean {
    if (this.overlay) return false;
    this.view = "inventory";

    const overlay = el("div", "pause-overlay");
    const panel = el("div", "pause-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Пауза");

    panel.appendChild(el("h2", "pause-heading", "Пауза"));
    const body = el("div", "pause-body");
    this.menu = el("nav", "pause-menu");
    this.menu.setAttribute("aria-label", "Меню паузы");
    this.content = el("section", "pause-content");
    body.append(this.menu, this.content);
    panel.appendChild(body);
    overlay.appendChild(panel);
    this.uiRoot.appendChild(overlay);
    this.overlay = overlay;

    this.keyTarget.addEventListener("keydown", this.onKeyDown, true);
    this.render();
    this.focusMenu(0);
    this.deps.onOpen?.();
    return true;
  }

  public close(): void {
    if (!this.overlay) return;
    this.keyTarget.removeEventListener("keydown", this.onKeyDown, true);
    this.settingsPane?.dispose();
    this.settingsPane = null;
    this.overlay.remove();
    this.overlay = this.content = this.menu = null;
    this.deps.onClose?.();
  }

  public toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  // -------------------------------------------------------------------------
  // Клавиши
  // -------------------------------------------------------------------------

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    // Идёт переназначение клавиши: событие заберёт KeyCapture (он сам отменяет по Esc).
    if (this.settingsPane?.isCapturing) return;

    // До игры клавиши не доходят, пока открыто меню (keyup пропускаем — отпускание клавиши игра должна увидеть).
    e.stopPropagation();

    const isEsc = e.code === "Escape";
    if (isEsc || this.deps.isPauseKey(e)) {
      e.preventDefault();
      // Автоповтор зажатой клавиши (той, которой открыли паузу) не должен сразу откатывать/закрывать меню.
      if (e.repeat) return;
      if (isEsc) this.back();
      else this.close();
    } else if (e.code === "ArrowDown" || e.code === "ArrowUp") {
      const buttons = this.menuButtons();
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (at >= 0) {
        e.preventDefault();
        this.focusMenu((at + (e.code === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length);
      }
    }
  };

  /** Esc: на шаг назад; из инвентаря — продолжить игру. */
  private back(): void {
    if (this.view === "inventory") this.close();
    else this.show("inventory");
  }

  // -------------------------------------------------------------------------
  // Разделы
  // -------------------------------------------------------------------------

  private show(view: View): void {
    if (this.view === "settings" && view !== "settings") {
      this.settingsPane?.dispose();
      this.settingsPane = null;
    }
    this.view = view;
    this.render();
  }

  private render(): void {
    this.renderMenu();
    this.renderContent();
  }

  private renderMenu(): void {
    const menu = this.menu!;
    menu.textContent = "";
    for (const item of MENU) {
      const active = item.view === this.view;
      const b = button(`${item.icon}  ${item.label}`, `pause-btn ${item.cls}${active ? " is-current" : ""}`.trim(), () => {
        if (item.view === "resume") this.close();
        else this.show(item.view);
        if (this.isOpen) this.focusMenu(MENU.findIndex((m) => m.view === item.view));
      });
      b.dataset.act = item.view;
      if (active) b.setAttribute("aria-current", "page");
      menu.appendChild(b);
    }

    const canSave = this.deps.canSave();
    menu.appendChild(
      el(
        "p",
        canSave ? "pause-save-note" : "pause-save-note is-warning",
        canSave ? "💾 Прогресс сохраняется автоматически" : "⚠ Браузер не даёт сохранять — прогресс пропадёт при закрытии вкладки",
      ),
    );
  }

  private renderContent(): void {
    const content = this.content!;
    content.textContent = "";
    if (this.view === "inventory") {
      content.appendChild(renderInventory(this.deps.gameState));
    } else if (this.view === "settings") {
      this.settingsPane ??= new SettingsPane({
        settings: this.deps.settings,
        isTouch: this.deps.isTouch,
        activeTier: this.deps.activeTier,
        autoTier: this.deps.autoTier,
        qualityFromUrl: this.deps.qualityFromUrl,
        keyTarget: this.keyTarget,
      });
      content.appendChild(this.settingsPane.element);
    } else {
      content.appendChild(this.confirmNewGame());
    }
  }

  private confirmNewGame(): HTMLElement {
    const box = el("div", "pause-confirm");
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-label", "Подтверждение новой игры");
    box.appendChild(el("h3", "pause-title", "Начать новую игру?"));
    box.appendChild(
      el(
        "p",
        "pause-confirm-text",
        "Весь сохранённый прогресс будет стёрт: найденные книги и страницы, изученные заклинания, побеждённые ведьмы и открытые сундуки. Мир создастся заново.",
      ),
    );
    const row = el("div", "pause-confirm-row");
    const stay = button("Остаться", "pause-btn is-primary", () => this.show("inventory"));
    stay.dataset.act = "stay";
    const startOver = button("Начать заново", "pause-btn is-danger", () => {
      this.close();
      this.deps.onNewGame();
    });
    startOver.dataset.act = "start-over";
    row.append(stay, startOver);
    box.appendChild(row);
    // Безопасный выбор по умолчанию — «Остаться».
    queueMicrotask(() => stay.focus());
    return box;
  }

  private menuButtons(): HTMLButtonElement[] {
    return this.menu ? (Array.from(this.menu.querySelectorAll("button")) as HTMLButtonElement[]) : [];
  }

  private focusMenu(index: number): void {
    this.menuButtons()[index]?.focus();
  }
}
