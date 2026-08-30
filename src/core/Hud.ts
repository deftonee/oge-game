/**
 * Простой HUD поверх канваса: полоска HP игрока + текстовая подсказка.
 * Отдельным DOM-слоем от боевого оверлея, чтобы бой мог рисоваться поверх.
 */
export class Hud {
  private fill: HTMLElement;
  public maxHp: number;
  private hp: number;

  constructor(uiRoot: HTMLElement, maxHp = 100) {
    this.maxHp = maxHp;
    this.hp = maxHp;

    const hud = document.createElement("div");
    hud.className = "hud";
    hud.innerHTML = `
      <div class="hud-bar-label">Здоровье</div>
      <div class="hud-bar"><div class="hud-bar-fill hp" style="width:100%"></div></div>
    `;
    uiRoot.appendChild(hud);
    this.fill = hud.querySelector(".hud-bar-fill") as HTMLElement;

    const hint = document.createElement("div");
    hint.className = "hud-hint";
    hint.textContent = "WASD — движение · мышь — камера · G — граф заклинаний · E — взаимодействие рядом";
    uiRoot.appendChild(hint);

    const lockedHint = document.createElement("div");
    lockedHint.className = "hud-locked-hint";
    lockedHint.style.display = "none";
    uiRoot.appendChild(lockedHint);
    this.lockedHintEl = lockedHint;

    const interactHint = document.createElement("div");
    interactHint.className = "hud-interact-hint";
    interactHint.style.display = "none";
    uiRoot.appendChild(interactHint);
    this.interactHintEl = interactHint;
  }

  private lockedHintEl!: HTMLElement;
  private interactHintEl!: HTMLElement;

  /** Показать/скрыть подсказку "заклинание ещё не изучено" рядом с ведьмой. */
  public setLockedHint(text: string | null): void {
    if (text) {
      this.lockedHintEl.textContent = text;
      this.lockedHintEl.style.display = "block";
    } else {
      this.lockedHintEl.style.display = "none";
    }
  }

  /** Показать/скрыть подсказку "нажми E" рядом с костром. */
  public setInteractHint(text: string | null): void {
    if (text) {
      this.interactHintEl.textContent = text;
      this.interactHintEl.style.display = "block";
    } else {
      this.interactHintEl.style.display = "none";
    }
  }

  public setHp(value: number): void {
    this.hp = Math.max(0, Math.min(this.maxHp, value));
    const pct = (this.hp / this.maxHp) * 100;
    this.fill.style.width = `${pct}%`;
  }

  public damage(amount: number): void {
    this.setHp(this.hp - amount);
  }

  public get currentHp(): number {
    return this.hp;
  }
}
