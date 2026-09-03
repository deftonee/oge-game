import { GameState, MAX_MASTERY } from "../core/GameState";
import {
  ALL_SCHOOLS,
  ALL_SPELLS,
  Spell,
  QUESTION_ROLES,
  ROLE_LABELS,
  getSchoolById,
  getSpellsBySchool,
  hasQuestionRole,
  isBridgeSpell,
  schoolOf,
} from "../data/spells";

const COL_WIDTH = 264;
const COL_GAP = 24;
const ROW_HEIGHT = 116;
const NODE_W = 168;
const NODE_H = 88;
const SCHOOL_HEADER_H = 92;
const PAD = 40;

interface NodePos {
  spell: Spell;
  x: number;
  y: number;
  ghost: boolean; // мост, показанный во второй школе (пунктирный)
}

/**
 * Граф прокачки: пять независимых веток-школ (колонок). Внутри школы —
 * порядок изучения (тир) и связи-пререквизиты. Мосты (заклинания двух школ)
 * рисуются в основной школе как обычные узлы, во второй — как пунктирные
 * «гхосты». Школа тайн висит закрытой, пока не выучены мосты (см. докy).
 * Само изучение происходит у костра (этап 5), тут только обзор.
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

  private layout(): { positions: NodePos[]; width: number; height: number } {
    const positions: NodePos[] = [];
    let maxTier = 1;

    ALL_SCHOOLS.forEach((school, sIdx) => {
      const colX = PAD + sIdx * (COL_WIDTH + COL_GAP);
      const centerX = colX + (COL_WIDTH - NODE_W) / 2;

      const primary = [...getSpellsBySchool(school.id)].sort((a, b) => a.tier - b.tier);
      for (const spell of primary) {
        maxTier = Math.max(maxTier, spell.tier);
        positions.push({
          spell,
          x: centerX,
          y: SCHOOL_HEADER_H + (spell.tier - 1) * ROW_HEIGHT,
          ghost: false,
        });
      }

      // Мост, принадлежащий сразу двум школам: во второй школе показываем гхоста.
      const ghosts = ALL_SPELLS.filter(
        (s) => isBridgeSpell(s) && s.schools.includes(school.id) && s.school !== school.id
      );
      for (const spell of ghosts) {
        maxTier = Math.max(maxTier, spell.tier);
        positions.push({
          spell,
          x: centerX,
          y: SCHOOL_HEADER_H + (spell.tier - 1) * ROW_HEIGHT,
          ghost: true,
        });
      }
    });

    const width = PAD + ALL_SCHOOLS.length * (COL_WIDTH + COL_GAP) + NODE_W;
    const height = SCHOOL_HEADER_H + maxTier * ROW_HEIGHT;
    return { positions, width, height };
  }

  private primaryPosOf(positions: NodePos[], spellId: string): NodePos | undefined {
    return positions.find((p) => p.spell.id === spellId && !p.ghost);
  }

  public open(): void {
    if (this.isOpen) return;
    const { positions, width, height } = this.layout();

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

    const body = document.createElement("div");
    body.className = "graph-body";

    const canvas = document.createElement("div");
    canvas.className = "graph-canvas";
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.classList.add("graph-lines");

    const posById = new Map(positions.map((p) => [p.spell.id, p]));

    for (const pos of positions) {
      for (const prereqId of pos.spell.prerequisites) {
        const from = this.primaryPosOf(positions, prereqId) ?? posById.get(prereqId);
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

    // Шапки школ (колонки)
    ALL_SCHOOLS.forEach((school, sIdx) => {
      const colX = PAD + sIdx * (COL_WIDTH + COL_GAP);
      const unlocked = this.gameState.isSchoolUnlocked(school.id);
      const { learned, total } = this.gameState.getSchoolProgress(school.id);

      const schoolHeader = document.createElement("div");
      schoolHeader.className = "graph-school" + (unlocked ? "" : " locked");
      schoolHeader.style.left = `${colX}px`;
      schoolHeader.style.width = `${COL_WIDTH}px`;
      schoolHeader.innerHTML = `
        <div class="graph-school-title" style="color:${school.color}">${school.icon} ${school.name}</div>
        <div class="graph-school-path">${school.pathName}</div>
        <div class="graph-school-progress">изучено ${learned}/${total}</div>
        ${
          !unlocked
            ? `<div class="graph-school-locked">🔒 откроется после ${school.unlockRule?.bridges ?? "?"} мостов</div>`
            : ""
        }
      `;
      canvas.appendChild(schoolHeader);

      if (total === 0) {
        const empty = document.createElement("div");
        empty.className = "graph-school-empty";
        empty.style.left = `${colX + 12}px`;
        empty.style.top = `${SCHOOL_HEADER_H + 24}px`;
        empty.style.width = `${COL_WIDTH - 24}px`;
        empty.textContent = unlocked
          ? "Ветка пока пуста — темы появятся позже."
          : "Закрыта. Найди мосты между школами.";
        canvas.appendChild(empty);
      }
    });

    const detail = document.createElement("div");
    detail.className = "graph-detail";
    detail.innerHTML = `<div class="graph-detail-hint">Выбери узел, чтобы посмотреть детали</div>`;

    const showDetail = (spell: Spell) => {
      const learned = this.gameState.isLearned(spell.id);
      const mastery = this.gameState.getMastery(spell.id);
      const unlockable = this.gameState.isUnlockable(spell);
      const missing = this.gameState.missingPrerequisites(spell);
      const schoolUnlocked = this.gameState.isSchoolUnlocked(spell.school);
      const school = schoolOf(spell);

      const roleNames = QUESTION_ROLES.filter((r) => hasQuestionRole(spell, r)).map((r) => ROLE_LABELS[r]);

      let statusHtml: string;
      if (learned) {
        const stars = "★".repeat(mastery) + "☆".repeat(MAX_MASTERY - mastery);
        statusHtml = `<div class="graph-detail-status ok">Изучено</div><div class="graph-detail-mastery" style="color:${spell.color}">${stars}</div>`;
      } else if (!schoolUnlocked) {
        statusHtml = `<div class="graph-detail-status locked">Школа закрыта</div><div class="graph-detail-missing">Нужно изучить ${school.unlockRule?.bridges ?? 0} моста(ов) — комбо-заклинания двух школ</div>`;
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
        <div class="graph-detail-school">${school.icon} ${school.name} · ${school.pathName}</div>
        <div class="graph-detail-formula">${spell.formula}</div>
        ${isBridgeSpell(spell) ? `<div class="graph-detail-missing">🌉 Мост: ${spell.schools.map((id) => getSchoolById(id).icon).join(" ")} — принадлежит ${spell.schools.length} школам</div>` : ""}
        ${roleNames.length > 0 ? `<div class="graph-detail-roles">${roleNames.join("<br>")}</div>` : ""}
        ${statusHtml}
      `;
    };

    for (const pos of positions) {
      const learned = this.gameState.isLearned(pos.spell.id);
      const unlockable = this.gameState.isUnlockable(pos.spell);
      const mastery = this.gameState.getMastery(pos.spell.id);
      const schoolUnlocked = this.gameState.isSchoolUnlocked(pos.spell.school);
      const bridge = isBridgeSpell(pos.spell);

      const cls = [
        "graph-node",
        learned ? "learned" : schoolUnlocked && unlockable ? "unlockable" : "locked",
        pos.ghost ? "ghost" : "",
        bridge ? "bridge" : "",
      ]
        .filter(Boolean)
        .join(" ");

      const node = document.createElement("button");
      node.className = cls;
      node.style.left = `${pos.x}px`;
      node.style.top = `${pos.y}px`;
      node.style.width = `${NODE_W}px`;
      node.style.height = `${NODE_H}px`;
      if (learned) node.style.borderColor = pos.spell.color;

      node.innerHTML = `
        <div class="graph-node-name">${pos.spell.name}</div>
        <div class="graph-node-formula">${pos.spell.formula}</div>
        ${bridge ? `<div class="graph-node-bridge">🌉 мост</div>` : ""}
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