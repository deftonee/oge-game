import type { PowerPool } from "./PowerPool";

interface BarLine {
  fill: HTMLElement;
  num: HTMLElement;
}

/**
 * Постоянная плашка шкал Силы наверху экрана: «Ты» и противник. Живёт весь бой —
 * окна вопросов меняются, а плашка остаётся (видна и пока окно спрятано на время
 * анимации удара). Сама подписывается на шкалы и обновляется по их изменению.
 */
export class BattleBar {
  private readonly root: HTMLElement;
  private readonly unsubscribe: Array<() => void> = [];

  constructor(uiRoot: HTMLElement, opponentTitle: string, player: PowerPool, opponent: PowerPool) {
    this.root = document.createElement("div");
    this.root.className = "battle-bar";
    uiRoot.appendChild(this.root);

    this.bind("Ты", "player", player);
    this.bind(opponentTitle, "opponent", opponent);
  }

  public dispose(): void {
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
    this.root.remove();
  }

  private bind(name: string, side: "player" | "opponent", pool: PowerPool): void {
    const line = this.createLine(name, side);
    const render = (): void => {
      line.fill.style.width = `${(pool.fraction * 100).toFixed(1)}%`;
      // Округляем вверх: «0» показываем, только когда Сила действительно кончилась.
      line.num.textContent = String(Math.ceil(pool.current));
    };
    render();
    this.unsubscribe.push(pool.subscribe(render));
  }

  private createLine(name: string, side: "player" | "opponent"): BarLine {
    const row = document.createElement("div");
    row.className = `battle-bar-line ${side}`;

    const label = document.createElement("span");
    label.className = "battle-bar-name";
    label.textContent = name;

    const track = document.createElement("div");
    track.className = "battle-bar-track";
    const fill = document.createElement("div");
    fill.className = "battle-bar-fill";
    track.appendChild(fill);

    const num = document.createElement("span");
    num.className = "battle-bar-num";

    row.append(label, track, num);
    this.root.appendChild(row);
    return { fill, num };
  }
}
