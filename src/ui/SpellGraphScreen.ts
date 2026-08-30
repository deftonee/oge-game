import { GameState, MAX_MASTERY } from "../core/GameState";
import { ALL_SPELLS, Spell } from "../data/spells";

const COL_WIDTH = 220;
const ROW_HEIGHT = 128;
const NODE_W = 168;
const NODE_H = 92;

interface NodePos {
  spell: Spell;
  x: number;
  y: number;
}

/**
 * Граф прокачки (п.2 ТЗ): узел — заклинание/закон физики, связи — пререквизиты.
 * Тир 1 (самое простое) слева, дальше сложнее. Узел кликабелен — показывает
 * детали справа. Само изучение происходит у костра (этап 5), тут только обзор
 * и понимание "что дальше открывать".
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

  private layout(): NodePos[] {
    const tiers = new Map<number, Spell[]>();
    for (const spell of ALL_SPELLS) {
      const arr = tiers.get(spell.tier) ?? [];
      arr.push(spell);
      tiers.set(spell.tier, arr);
    }
    const positions: NodePos[] = [];
    for (const [tier, spells] of tiers) {
      spells.forEach((spell, i) => {
        positions.push({
          spell,
          x: (tier - 1) * COL_WIDTH + 40,
          y: i * ROW_HEIGHT + 40,
        });
      });
    }
    return positions;
  }

  public open(): void {
    if (this.isOpen) return;
    const positions = this.layout();
    const maxTier = Math.max(...ALL_SPELLS.map((s) => s.tier));
    const maxRows = Math.max(
      ...Array.from(new Set(ALL_SPELLS.map((s) => s.tier))).map(
        (t) => ALL_SPELLS.filter((s) => s.tier === t).length
      )
    );
    const canvasW = maxTier * COL_WIDTH + NODE_W;
    const canvasH = maxRows * ROW_HEIGHT + NODE_H;

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
        <div class="graph-subtitle">Законы физики от простого к сложному</div>
      </div>
    `;
    const closeBtn = document.createElement("button");
    closeBtn.className = "graph-close";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => this.close());
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const body = document.createElement("div");
    body.className = "graph-body";

    const canvas = document.createElement("div");
    canvas.className = "graph-canvas";
    canvas.style.width = `${canvasW}px`;
    canvas.style.height = `${canvasH}px`;

    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("width", String(canvasW));
    svg.setAttribute("height", String(canvasH));
    svg.classList.add("graph-lines");

    const posById = new Map(positions.map((p) => [p.spell.id, p]));

    for (const pos of positions) {
      for (const prereqId of pos.spell.prerequisites) {
        const from = posById.get(prereqId);
        if (!from) continue;
        const x1 = from.x + NODE_W;
        const y1 = from.y + NODE_H / 2;
        const x2 = pos.x;
        const y2 = pos.y + NODE_H / 2;
        const midX = (x1 + x2) / 2;
        const path = document.createElementNS(svgNs, "path");
        path.setAttribute("d", `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
        const bothLearned = this.gameState.isLearned(prereqId) && this.gameState.isLearned(pos.spell.id);
        path.setAttribute("class", bothLearned ? "graph-edge graph-edge-active" : "graph-edge");
        svg.appendChild(path);
      }
    }
    canvas.appendChild(svg);

    const detail = document.createElement("div");
    detail.className = "graph-detail";
    detail.innerHTML = `<div class="graph-detail-hint">Выбери узел, чтобы посмотреть детали</div>`;

    const showDetail = (spell: Spell) => {
      const learned = this.gameState.isLearned(spell.id);
      const mastery = this.gameState.getMastery(spell.id);
      const unlockable = this.gameState.isUnlockable(spell);
      const missing = this.gameState.missingPrerequisites(spell);

      let statusHtml: string;
      if (learned) {
        const stars = "★".repeat(mastery) + "☆".repeat(MAX_MASTERY - mastery);
        statusHtml = `<div class="graph-detail-status ok">Изучено</div><div class="graph-detail-mastery" style="color:${spell.color}">${stars}</div>`;
      } else if (unlockable) {
        statusHtml = `<div class="graph-detail-status open">Доступно — найди костёр</div>`;
      } else {
        statusHtml = `<div class="graph-detail-status locked">Заблокировано</div><div class="graph-detail-missing">Нужно изучить: ${missing
          .map((m) => m.name)
          .join(", ")}</div>`;
      }

      detail.innerHTML = `
        <div class="graph-detail-name" style="color:${spell.color}">${spell.name}</div>
        <div class="graph-detail-law">${spell.law}</div>
        <div class="graph-detail-formula">${spell.formula}</div>
        ${statusHtml}
      `;
    };

    for (const pos of positions) {
      const learned = this.gameState.isLearned(pos.spell.id);
      const unlockable = this.gameState.isUnlockable(pos.spell);
      const mastery = this.gameState.getMastery(pos.spell.id);

      const node = document.createElement("button");
      node.className = "graph-node" + (learned ? " learned" : unlockable ? " unlockable" : " locked");
      node.style.left = `${pos.x}px`;
      node.style.top = `${pos.y}px`;
      node.style.width = `${NODE_W}px`;
      node.style.height = `${NODE_H}px`;
      if (learned) {
        node.style.borderColor = pos.spell.color;
      }

      node.innerHTML = `
        <div class="graph-node-name">${pos.spell.name}</div>
        <div class="graph-node-formula">${pos.spell.formula}</div>
        ${learned ? `<div class="graph-node-mastery">Ур. ${mastery}/${MAX_MASTERY}</div>` : ""}
        ${!learned && !unlockable ? `<div class="graph-node-lock">🔒</div>` : ""}
      `;
      node.addEventListener("click", () => showDetail(pos.spell));
      canvas.appendChild(node);
    }

    body.appendChild(canvas);
    body.appendChild(detail);
    panel.appendChild(body);
    overlay.appendChild(panel);
    this.uiRoot.appendChild(overlay);
    this.overlay = overlay;
  }
}
