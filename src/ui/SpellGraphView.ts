import { GameState, MAX_MASTERY } from "../core/GameState";
import { booksRequiredFor, getBookBySchool } from "../data/books";
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
/** Зазор между узлами одного ряда внутри колонки (если в ряду их несколько). */
const LANE_GAP = 20;

interface NodePos {
  spell: Spell;
  x: number;
  y: number;
  ghost: boolean; // мост, показанный во второй школе (пунктирный)
}

/**
 * Что показывать: весь граф прокачки или только то, что игрок уже изучил
 * (дерево в инвентаре). В режиме «learned» остаются только школы с изученным,
 * а ряды сжимаются до реально занятых тиров — дерево компактное, без дыр.
 */
export type SpellGraphMode = "all" | "learned";

export interface SpellGraphView {
  /** Тело графа (холст со связями и узлами + панель деталей), готовое к вставке. */
  element: HTMLElement;
  /** Сколько узлов нарисовано (в режиме learned — сколько заклинаний изучено). */
  nodeCount: number;
}

/**
 * Ряд заклинания: не меньше тира и всегда ниже всех своих пререквизитов — так
 * цепочка «ускорение → сила» (оба тира 2) не склеивается в одну позицию. Считается
 * по всему графу сразу (мост берёт ряд из своей основной школы, а его гхост во
 * второй школе стоит в том же ряду, и связи не ломаются).
 */
function computeRows(): Map<string, number> {
  const byId = new Map(ALL_SPELLS.map((s) => [s.id, s]));
  const rows = new Map<string, number>();
  const visiting = new Set<string>();
  const rowOf = (spell: Spell): number => {
    const known = rows.get(spell.id);
    if (known !== undefined) return known;
    if (visiting.has(spell.id)) return spell.tier - 1; // цикл в данных не должен вешать интерфейс
    visiting.add(spell.id);
    let row = spell.tier - 1;
    for (const preId of spell.prerequisites) {
      const pre = byId.get(preId);
      if (pre) row = Math.max(row, rowOf(pre) + 1);
    }
    visiting.delete(spell.id);
    rows.set(spell.id, row);
    return row;
  };
  for (const spell of ALL_SPELLS) rowOf(spell);
  return rows;
}

/**
 * Раскладка узлов. Колонка — школа; ряд — по цепочке пререквизитов; если в одном
 * ряду колонки несколько заклинаний (два корня ветки, мост рядом с обычной темой),
 * они встают рядом и колонка расширяется — узлы никогда не накладываются.
 * В режиме «learned» остаются только изученные: пустые школы и пустые ряды убираются.
 */
function layout(
  gameState: GameState,
  mode: SpellGraphMode
): { positions: NodePos[]; columns: Array<{ school: (typeof ALL_SCHOOLS)[number]; x: number; width: number }>; width: number; height: number } {
  const wanted = (spell: Spell): boolean => mode === "all" || gameState.isLearned(spell.id);
  const rowById = computeRows();

  const columnSpells = ALL_SCHOOLS.map((school) => {
    const primary = ALL_SPELLS.filter((s) => s.school === school.id && wanted(s));
    // Мост, принадлежащий сразу двум школам: во второй школе показываем гхоста.
    const ghosts = ALL_SPELLS.filter((s) => isBridgeSpell(s) && s.schools.includes(school.id) && s.school !== school.id && wanted(s));
    return { school, primary, ghosts };
  });
  const included = mode === "all" ? columnSpells : columnSpells.filter((c) => c.primary.length + c.ghosts.length > 0);

  // Ряды: в полном графе — как вычислено; в сжатом — порядковый номер среди занятых рядов.
  const usedRows = [...new Set(included.flatMap((c) => [...c.primary, ...c.ghosts].map((s) => rowById.get(s.id)!)))].sort((a, b) => a - b);
  const displayRow = (spell: Spell): number => (mode === "all" ? rowById.get(spell.id)! : usedRows.indexOf(rowById.get(spell.id)!));
  const rowCount = mode === "all" ? Math.max(1, ...ALL_SPELLS.map((s) => rowById.get(s.id)! + 1)) : usedRows.length;

  const positions: NodePos[] = [];
  const columns: Array<{ school: (typeof ALL_SCHOOLS)[number]; x: number; width: number }> = [];
  let colX = PAD;

  for (const { school, primary, ghosts } of included) {
    const nodes = [...primary.map((spell) => ({ spell, ghost: false })), ...ghosts.map((spell) => ({ spell, ghost: true }))];
    const perRow = new Map<number, typeof nodes>();
    for (const n of nodes) {
      const r = displayRow(n.spell);
      perRow.set(r, [...(perRow.get(r) ?? []), n]);
    }
    const lanes = Math.max(1, ...[...perRow.values()].map((list) => list.length));
    const colWidth = Math.max(COL_WIDTH, lanes * NODE_W + (lanes - 1) * LANE_GAP + 2 * 48);

    for (const [row, list] of perRow) {
      const total = list.length * NODE_W + (list.length - 1) * LANE_GAP;
      const startX = colX + (colWidth - total) / 2;
      list.forEach((n, i) => {
        positions.push({ spell: n.spell, x: startX + i * (NODE_W + LANE_GAP), y: SCHOOL_HEADER_H + row * ROW_HEIGHT, ghost: n.ghost });
      });
    }
    columns.push({ school, x: colX, width: colWidth });
    colX += colWidth + COL_GAP;
  }

  return { positions, columns, width: colX + NODE_W, height: SCHOOL_HEADER_H + rowCount * ROW_HEIGHT };
}

function primaryPosOf(positions: NodePos[], spellId: string): NodePos | undefined {
  return positions.find((p) => p.spell.id === spellId && !p.ghost);
}

/**
 * Граф прокачки: пять независимых веток-школ (колонок). Внутри школы —
 * порядок изучения (тир) и связи-пререквизиты. Мосты (заклинания двух школ)
 * рисуются в основной школе как обычные узлы, во второй — как пунктирные
 * «гхосты». Школа тайн висит закрытой, пока не выучены мосты.
 * Само изучение происходит у костра, тут только обзор. Чтобы выучить тему, мало
 * открыть её по дереву — нужны ещё найденные в сундуках книга школы и страница
 * заклинания: узел без них рисуется как «нужны материалы», а в деталях видно,
 * чего именно не хватает.
 *
 * Одна функция строит и полный граф (экран по клавише G), и дерево изученного
 * (инвентарь в меню паузы) — разметка и стили общие.
 */
export function createSpellGraphView(gameState: GameState, mode: SpellGraphMode = "all"): SpellGraphView {
  const { positions, columns, width, height } = layout(gameState, mode);

  const body = document.createElement("div");
  body.className = "graph-body";

  if (mode === "learned" && positions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "graph-empty";
    empty.textContent = "Пока не изучено ни одного заклинания. Найди книги и страницы в сундуках и выучи тему у костра — она появится здесь.";
    body.appendChild(empty);
    return { element: body, nodeCount: 0 };
  }

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
      const from = primaryPosOf(positions, prereqId) ?? posById.get(prereqId);
      if (!from) continue;
      const x1 = from.x + NODE_W;
      const y1 = from.y + NODE_H / 2;
      const x2 = pos.x;
      const y2 = pos.y + NODE_H / 2;
      const midX = (x1 + x2) / 2;
      const path = document.createElementNS(svgNs, "path");
      path.setAttribute("d", `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
      const bothLearned = gameState.isLearned(prereqId) && gameState.isLearned(pos.spell.id);
      path.setAttribute("class", bothLearned ? "graph-edge graph-edge-active" : "graph-edge");
      svg.appendChild(path);
    }
  }
  canvas.appendChild(svg);

  // Прогресс сбора материалов школы: книга найдена? сколько страниц из скольки.
  const materialsLine = (schoolId: string, total: number): string => {
    const book = getBookBySchool(schoolId);
    if (!book || total === 0) return "";
    const pages = book.pages.filter((p) => gameState.hasBookPage(p.id)).length;
    return ` · 📖 ${gameState.hasBook(book.id) ? "✓" : "✗"} · 📄 ${pages}/${book.pages.length}`;
  };

  // Шапки школ (колонки)
  columns.forEach(({ school, x: colX, width: colWidth }) => {
    const unlocked = gameState.isSchoolUnlocked(school.id);
    const { learned, total } = gameState.getSchoolProgress(school.id);

    const schoolHeader = document.createElement("div");
    schoolHeader.className = "graph-school" + (unlocked ? "" : " locked");
    schoolHeader.style.left = `${colX}px`;
    schoolHeader.style.width = `${colWidth}px`;
    schoolHeader.innerHTML = `
        <div class="graph-school-title" style="color:${school.color}">${school.icon} ${school.name}</div>
        <div class="graph-school-path">${school.pathName}</div>
        <div class="graph-school-progress">изучено ${learned}/${total}${materialsLine(school.id, total)}</div>
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
      empty.style.width = `${colWidth - 24}px`;
      empty.textContent = unlocked ? "Ветка пока пуста — темы появятся позже." : "Закрыта. Найди мосты между школами.";
      canvas.appendChild(empty);
    }
  });

  const detail = document.createElement("div");
  detail.className = "graph-detail";
  detail.innerHTML = `<div class="graph-detail-hint">Выбери узел, чтобы посмотреть детали</div>`;

  const showDetail = (spell: Spell): void => {
    const learned = gameState.isLearned(spell.id);
    const mastery = gameState.getMastery(spell.id);
    const unlockable = gameState.isUnlockable(spell);
    const hasMaterials = gameState.hasMaterials(spell);
    const missing = gameState.missingPrerequisites(spell);
    const schoolUnlocked = gameState.isSchoolUnlocked(spell.school);
    const school = schoolOf(spell);

    // Материалы: нужные книги и страница — что найдено, чего нет.
    const materialsHtml = (): string => {
      const rows: string[] = [];
      for (const book of booksRequiredFor(spell)) {
        const has = gameState.hasBook(book.id);
        rows.push(`<div class="${has ? "have" : "miss"}">📖 ${book.title}: ${has ? "найдена" : "не найдена"}</div>`);
      }
      const hasPage = gameState.hasSpellPage(spell);
      rows.push(`<div class="${hasPage ? "have" : "miss"}">📄 Страница: ${hasPage ? "найдена" : "не найдена"}</div>`);
      return `<div class="graph-detail-mats">${rows.join("")}</div>`;
    };

    const roleNames = QUESTION_ROLES.filter((r) => hasQuestionRole(spell, r)).map((r) => ROLE_LABELS[r]);

    let statusHtml: string;
    if (learned) {
      const stars = "★".repeat(mastery) + "☆".repeat(MAX_MASTERY - mastery);
      statusHtml = `<div class="graph-detail-status ok">Изучено</div><div class="graph-detail-mastery" style="color:${spell.color}">${stars}</div>`;
    } else if (!schoolUnlocked) {
      statusHtml = `<div class="graph-detail-status locked">Школа закрыта</div><div class="graph-detail-missing">Нужно изучить ${school.unlockRule?.bridges ?? 0} моста(ов) — комбо-заклинания двух школ</div>`;
    } else if (unlockable && hasMaterials) {
      statusHtml = `<div class="graph-detail-status open">Доступно — найди костёр</div>${materialsHtml()}`;
    } else if (unlockable) {
      statusHtml = `<div class="graph-detail-status need">Нужны материалы — ищи в сундуках</div>${materialsHtml()}`;
    } else {
      statusHtml = `<div class="graph-detail-status locked">Заблокировано</div><div class="graph-detail-missing">Нужно изучить: ${missing
        .map((m) => m.name)
        .join(", ")}</div>${materialsHtml()}`;
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
    const learned = gameState.isLearned(pos.spell.id);
    const unlockable = gameState.isUnlockable(pos.spell);
    const hasMaterials = gameState.hasMaterials(pos.spell);
    const mastery = gameState.getMastery(pos.spell.id);
    const schoolUnlocked = gameState.isSchoolUnlocked(pos.spell.school);
    const bridge = isBridgeSpell(pos.spell);

    // learned — изучено; unlockable — можно учить у костра сейчас;
    // needs-material — по дереву открыто, но нет книги/страницы; locked — остальное.
    const cls = [
      "graph-node",
      learned ? "learned" : schoolUnlocked && unlockable ? (hasMaterials ? "unlockable" : "needs-material") : "locked",
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
        ${!learned && unlockable && !hasMaterials ? `<div class="graph-node-lock">📄</div>` : ""}
      `;
    node.addEventListener("click", () => showDetail(pos.spell));
    canvas.appendChild(node);
  }

  body.appendChild(canvas);
  body.appendChild(detail);
  return { element: body, nodeCount: positions.filter((p) => !p.ghost).length };
}
