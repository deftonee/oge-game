// Граф заклинаний как переиспользуемое представление: режим «all» (экран G) и «learned» (инвентарь).
import { Window } from "happy-dom";
import { GameState } from "../src/core/GameState";
import { createSpellGraphView } from "../src/ui/SpellGraphView";
import { ALL_BOOKS } from "../src/data/books";
import { ALL_SPELLS, isBridgeSpell } from "../src/data/spells";
import type { Spell } from "../src/data/spells";

declare const process: { exit(code?: number): never };

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

const win = new Window({ url: "http://localhost/" });
const g = globalThis as unknown as Record<string, unknown>;
g.window = win;
g.document = win.document;

const ROW_HEIGHT = 116;
const HEADER_H = 92;

const nodes = (el: HTMLElement): HTMLElement[] => Array.from(el.querySelectorAll(".graph-node")) as unknown as HTMLElement[];
const px = (v: string): number => parseFloat(v);

interface Box {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
const boxes = (el: HTMLElement): Box[] =>
  nodes(el).map((n) => ({ name: n.textContent!.trim().split("\n")[0] + (n.classList.contains("ghost") ? " (гхост)" : ""), x: px(n.style.left), y: px(n.style.top), w: px(n.style.width), h: px(n.style.height) }));
/** Пары узлов, чьи прямоугольники пересекаются (должно быть пусто). */
function overlaps(list: Box[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push(`${a.name} × ${b.name}`);
    }
  }
  return out;
}
/** Зависимое заклинание лежит строго ниже своего пререквизита (в основной позиции). */
function dependentsBelowPrereqs(el: HTMLElement): string[] {
  const top = new Map<string, number>();
  for (const n of nodes(el)) {
    if (n.classList.contains("ghost")) continue;
    const spell = ALL_SPELLS.find((s) => n.textContent!.includes(s.name));
    if (spell) top.set(spell.id, px(n.style.top));
  }
  const bad: string[] = [];
  for (const [id, y] of top) {
    for (const pre of ALL_SPELLS.find((s) => s.id === id)!.prerequisites) {
      if (top.has(pre) && !(y > top.get(pre)!)) bad.push(`${pre} → ${id}`);
    }
  }
  return bad;
}

/** Выучить всё, что можно выучить при полном наборе материалов (до неподвижной точки). */
function learnEverythingPossible(gs: GameState): Spell[] {
  for (const b of ALL_BOOKS) {
    gs.collectBook(b.id);
    for (const p of b.pages) gs.collectBookPage(p.id);
  }
  const learned: Spell[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const s of ALL_SPELLS) {
      if (!gs.isLearned(s.id) && gs.isUnlockable(s) && gs.hasMaterials(s) && gs.isSchoolUnlocked(s.school)) {
        gs.learn(s.id);
        learned.push(s);
        progress = true;
      }
    }
  }
  return learned;
}

// --- пустой инвентарь ---------------------------------------------------------------
{
  const view = createSpellGraphView(new GameState(), "learned");
  check(view.nodeCount === 0, "ничего не изучено — узлов нет");
  check(view.element.querySelector(".graph-empty") !== null && view.element.querySelector(".graph-canvas") === null, "вместо пустого холста — понятная подсказка");
  check(view.element.textContent!.includes("Пока не изучено"), "текст подсказки объясняет, что делать");
}

// --- одно изученное заклинание ------------------------------------------------------
{
  const gs = new GameState();
  const learned = learnEverythingPossible(new GameState());
  check(learned.length >= 2, `в данных можно выучить несколько тем (${learned.length})`);

  const one = new GameState();
  for (const b of ALL_BOOKS) {
    one.collectBook(b.id);
    for (const p of b.pages) one.collectBookPage(p.id);
  }
  one.learn("velocity");
  const view = createSpellGraphView(one, "learned");
  const all = createSpellGraphView(one, "all");
  check(view.nodeCount === 1 && nodes(view.element).length === 1, "изучена одна тема — на холсте один узел");
  check(nodes(view.element)[0].classList.contains("learned"), "узел помечен как изученный");
  check(view.element.querySelectorAll(".graph-school").length === 1, "показана одна школа — с изученным");
  const w1 = px((view.element.querySelector(".graph-canvas") as HTMLElement).style.width);
  const wAll = px((all.element.querySelector(".graph-canvas") as HTMLElement).style.width);
  check(w1 < wAll / 2, `дерево компактнее полного графа (${w1}px против ${wAll}px)`);
  check(nodes(view.element)[0].style.top === `${HEADER_H}px`, "единственный узел стоит в первом ряду");

  nodes(view.element)[0].click();
  check(view.element.querySelector(".graph-detail")!.textContent!.includes("Изучено"), "клик по узлу показывает детали «Изучено»");
  void gs;
}

// --- всё, что можно выучить ---------------------------------------------------------
{
  const gs = new GameState();
  const learned = learnEverythingPossible(gs);
  const view = createSpellGraphView(gs, "learned");
  const all = createSpellGraphView(gs, "all");
  const learnedIds = new Set(learned.map((s) => s.id));

  const placed = nodes(view.element);
  const primary = placed.filter((n) => !n.classList.contains("ghost"));
  check(view.nodeCount === learned.length && primary.length === learned.length, `узлов ровно столько, сколько изучено (${primary.length}/${learned.length})`);
  check(placed.every((n) => n.classList.contains("learned")), "в дереве только изученные темы");
  check(!view.element.querySelector(".graph-node.locked, .graph-node.needs-material, .graph-node.unlockable"), "нет «заблокировано/нужны материалы/доступно»");
  check(primary.every((n) => [...learnedIds].some((id) => n.textContent!.includes(ALL_SPELLS.find((s) => s.id === id)!.name))), "каждый узел — изученное заклинание");

  // Мосты: гхост во второй школе рисуется только если мост изучен.
  const bridgesLearned = learned.filter(isBridgeSpell);
  const expectedGhosts = bridgesLearned.reduce((n, s) => n + (s.schools.length - 1), 0);
  check(placed.filter((n) => n.classList.contains("ghost")).length === expectedGhosts, `гхостов моста ровно ${expectedGhosts}`);

  // Ряды сжаты: занятые ряды идут подряд с нуля, без дыр.
  const rows = [...new Set(placed.map((n) => (px(n.style.top) - HEADER_H) / ROW_HEIGHT))].sort((a, b) => a - b);
  check(rows.every((r, i) => r === i), `ряды идут подряд без дыр: [${rows.join(",")}]`);
  const hLearned = px((view.element.querySelector(".graph-canvas") as HTMLElement).style.height);
  const hAll = px((all.element.querySelector(".graph-canvas") as HTMLElement).style.height);
  check(hLearned <= hAll, "высота дерева не больше полного графа");

  // Связи: между изученными темами все рёбра «активные».
  const edges = Array.from(view.element.querySelectorAll(".graph-edge")) as unknown as HTMLElement[];
  check(edges.length > 0 && edges.every((e) => e.getAttribute("class")!.includes("graph-edge-active")), `все ${edges.length} связей активны`);

  // Колонки не пересекаются и узлы внутри холста.
  const w = px((view.element.querySelector(".graph-canvas") as HTMLElement).style.width);
  check(placed.every((n) => px(n.style.left) >= 0 && px(n.style.left) + px(n.style.width) <= w && px(n.style.top) + px(n.style.height) <= hLearned), "все узлы лежат внутри холста");
  check(overlaps(boxes(view.element)).length === 0, `дерево изученного: узлы не пересекаются (${overlaps(boxes(view.element)).join("; ") || "ок"})`);
  check(dependentsBelowPrereqs(view.element).length === 0, `дерево изученного: зависимые ниже пререквизитов (${dependentsBelowPrereqs(view.element).join("; ") || "ок"})`);
  check(overlaps(boxes(all.element)).length === 0, `полный граф (всё изучено): узлы не пересекаются (${overlaps(boxes(all.element)).join("; ") || "ок"})`);
  check(dependentsBelowPrereqs(all.element).length === 0, "полный граф: зависимые ниже пререквизитов");

  // Шапки школ показывают прогресс и материалы.
  check(view.element.textContent!.includes("📖 ✓"), "в шапке школы видно, что книга найдена");
}

// --- полный граф не изменился -----------------------------------------------------
{
  const gs = new GameState();
  const all = createSpellGraphView(gs, "all");
  check(all.element.className === "graph-body" && all.element.querySelectorAll(".graph-school").length === 5, "режим all: пять школ, как раньше");
  check(nodes(all.element).length >= ALL_SPELLS.length, "режим all: все заклинания на холсте");
  check(createSpellGraphView(gs).element.innerHTML === all.element.innerHTML, "режим по умолчанию — all");
  check(overlaps(boxes(all.element)).length === 0, `полный граф (начало игры): узлы не пересекаются (${overlaps(boxes(all.element)).join("; ") || "ок"})`);
  check(dependentsBelowPrereqs(all.element).length === 0, "полный граф (начало игры): зависимые ниже пререквизитов");
  // Каждая школа в полном графе: шапка охватывает свои узлы по горизонтали.
  const headers = Array.from(all.element.querySelectorAll(".graph-school")) as unknown as HTMLElement[];
  check(headers.length === 5 && headers.every((h, i) => i === 0 || px(h.style.left) >= px(headers[i - 1].style.left) + px(headers[i - 1].style.width)), "колонки школ идут слева направо без наложения");
  const wide = nodes(all.element).filter((n) => px(n.style.left) > 0).every((n) => headers.some((h) => px(n.style.left) >= px(h.style.left) && px(n.style.left) + px(n.style.width) <= px(h.style.left) + px(h.style.width)));
  check(wide, "каждый узел лежит внутри колонки своей школы");
}

if (failures > 0) {
  console.error(`\n${failures} из ${checks} проверок не прошли`);
  process.exit(1);
}
console.log(`OK: граф заклинаний (all/learned) прошёл ${checks} проверок`);
