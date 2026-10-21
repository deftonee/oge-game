import { GameState } from "../core/GameState";
import { createSpellGraphView } from "./SpellGraphView";

/**
 * Экран «Граф заклинаний» (клавиша G): оверлей с шапкой и полным графом прокачки.
 * Само дерево строит createSpellGraphView — тот же код рисует дерево изученного
 * в инвентаре меню паузы. Изучение происходит у костра, тут только обзор.
 */
export class SpellGraphScreen {
  private overlay: HTMLElement | null = null;

  constructor(private uiRoot: HTMLElement, private gameState: GameState) {}

  public get isOpen(): boolean {
    return this.overlay !== null;
  }

  public toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  public close(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  public open(): void {
    if (this.isOpen) return;

    const overlay = document.createElement("div");
    overlay.className = "graph-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.close();
    });

    const panel = document.createElement("div");
    panel.className = "graph-panel";

    const header = document.createElement("div");
    header.className = "graph-header";
    header.innerHTML = `
      <div>
        <div class="graph-title">Граф заклинаний</div>
        <div class="graph-subtitle">Пять школ физики — каждая ветка качается независимо</div>
      </div>
    `;
    const closeBtn = document.createElement("button");
    closeBtn.className = "graph-close";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => this.close());
    header.appendChild(closeBtn);
    panel.appendChild(header);

    panel.appendChild(createSpellGraphView(this.gameState, "all").element);
    overlay.appendChild(panel);
    this.uiRoot.appendChild(overlay);
    this.overlay = overlay;
  }
}
