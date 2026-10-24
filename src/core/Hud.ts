import type { PowerPool } from "../combat/PowerPool";

/**
 * Простой HUD поверх канваса: шкала Силы игрока + текстовые подсказки.
 * Отдельным DOM-слоем от боевого оверлея, чтобы бой мог рисоваться поверх.
 */
export class Hud {
  private fill: HTMLElement;

  constructor(uiRoot: HTMLElement) {
    const hud = document.createElement("div");
    hud.className = "hud";
    hud.innerHTML = `
      <div class="hud-bar-label">Сила</div>
      <div class="hud-bar"><div class="hud-bar-fill power" style="width:100%"></div></div>
    `;
    uiRoot.appendChild(hud);
    this.fill = hud.querySelector(".hud-bar-fill") as HTMLElement;

    const hint = document.createElement("div");
    hint.className = "hud-hint";
    hint.textContent = "WASD — движение · мышь — камера · G — граф заклинаний · E — взаимодействие рядом";
    uiRoot.appendChild(hint);
    this.hintEl = hint;

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

    const stealthBadge = document.createElement("div");
    stealthBadge.className = "hud-stealth";
    stealthBadge.style.display = "none";
    uiRoot.appendChild(stealthBadge);
    this.stealthBadgeEl = stealthBadge;
  }

  private hintEl!: HTMLElement;
  private lockedHintEl!: HTMLElement;
  private interactHintEl!: HTMLElement;
  private stealthBadgeEl!: HTMLElement;

  /** Подсказка управления внизу экрана (зависит от раскладки клавиш в настройках). */
  public setControlsHint(text: string): void {
    if (this.hintEl.textContent !== text) this.hintEl.textContent = text;
  }

  /** Плашка стелса («🌿 В укрытии»); null — скрыть. */
  public setStealthBadge(text: string | null): void {
    if (text) {
      if (this.stealthBadgeEl.textContent !== text) this.stealthBadgeEl.textContent = text;
      this.stealthBadgeEl.style.display = "block";
    } else {
      this.stealthBadgeEl.style.display = "none";
    }
  }

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

  /** Показывать шкалу Силы игрока: полоска сама следует за изменениями шкалы. Возвращает функцию отписки. */
  public bindPower(pool: PowerPool): () => void {
    const render = (): void => {
      this.fill.style.width = `${(pool.fraction * 100).toFixed(1)}%`;
    };
    render();
    return pool.subscribe(render);
  }
}
