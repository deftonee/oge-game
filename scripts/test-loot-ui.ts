// Smoke-тест UI книг и страниц на happy-dom: окно находок из сундука, меню
// костра (что можно изучить / чего не хватает) и граф заклинаний (статусы узлов).
// Проверяется, что окна рендерятся без ошибок и показывают верное состояние.
import { Window } from "happy-dom";
import { GameState } from "../src/core/GameState";
import { ALL_SPELLS, getSpellById } from "../src/data/spells";
import { bookIdOfSchool, getBookById, getBookPageById, pageIdOfSpell } from "../src/data/books";
import { ChestLootScreen } from "../src/ui/ChestLootScreen";
import { LearningManager } from "../src/learning/LearningManager";
import { SpellGraphScreen } from "../src/ui/SpellGraphScreen";

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

function freshRoot(): HTMLElement {
  win.document.body.innerHTML = "";
  const root = win.document.createElement("div");
  win.document.body.appendChild(root);
  return root as unknown as HTMLElement;
}

const earthBookId = bookIdOfSchool("earth");
const velocity = getSpellById("velocity");
const flame = getSpellById("flame");

// ---------------------------------------------------------------------------
// 1. Окно находок из сундука.
// ---------------------------------------------------------------------------
{
  const root = freshRoot();
  const gs = new GameState();
  const screen = new ChestLootScreen(root, gs);
  check(!screen.isOpen, "окно находок изначально закрыто");

  screen.show({ books: [], pages: [] });
  check(screen.isOpen, "окно открылось");
  check(root.textContent!.includes("Сундук пуст"), "пустой сундук так и подписан");
  screen.close();
  check(!screen.isOpen && root.children.length === 0, "окно закрылось и убралось из DOM");

  // Книга + страница: после находки заклинание можно изучить — окно так и говорит.
  gs.recordChestLoot("c", { bookIds: [earthBookId], pageIds: [pageIdOfSpell("velocity")] });
  screen.show({ books: [getBookById(earthBookId)!], pages: [getBookPageById(pageIdOfSpell("velocity"))!] });
  const text = root.textContent!;
  check(text.includes("Книга «Путь Странника»"), "показана найденная книга");
  check(text.includes(`Страница «${velocity.name}»`), "показана найденная страница");
  check(text.includes("Можно изучить у костра"), "для готовой страницы — «можно изучить у костра»");
  screen.close();

  // Страница без книги: окно объясняет, чего не хватает.
  const gs2 = new GameState();
  gs2.collectBookPage(pageIdOfSpell("velocity"));
  const screen2 = new ChestLootScreen(root, gs2);
  screen2.show({ books: [], pages: [getBookPageById(pageIdOfSpell("velocity"))!] });
  check(root.textContent!.includes("Пока нужно: книга «Путь Странника»"), "страница без книги: названа недостающая книга");
  screen2.close();
}

// ---------------------------------------------------------------------------
// 2. Меню костра: что можно изучить и чего не хватает.
// ---------------------------------------------------------------------------
{
  const root = freshRoot();
  const gs = new GameState();
  const learning = new LearningManager(root, gs, { onSpellLearned: () => {} });

  learning.open();
  let text = root.textContent!;
  check(!root.querySelector(".bonfire-spell-option"), "без материалов у костра нечего изучать");
  check(text.includes("Ищи их в сундуках"), "пустое меню подсказывает искать книги и страницы в сундуках");
  check(text.includes("Не хватает материалов"), "показан список «Не хватает материалов»");
  check(text.includes("📖 книга «Путь Странника»") && text.includes("📄 страница"), "для velocity названы и книга, и страница");
  check(!text.includes(flame.name), "заклинание без пререквизита не светится в списке нехватки (дерево ещё закрыто)");
  learning.close();

  // Книга найдена, страниц нет → в нехватке остаётся только страница.
  gs.collectBook(earthBookId);
  learning.open();
  text = root.textContent!;
  check(!text.includes("📖 книга «Путь Странника»") && text.includes("📄 страница"), "книга есть — в нехватке только страница");
  learning.close();

  // Материалы собраны → заклинание появилось в списке для изучения.
  gs.collectBookPage(pageIdOfSpell("velocity"));
  learning.open();
  const options = root.querySelectorAll(".bonfire-spell-option");
  check(options.length === 1, `можно изучить ровно одну тему, а в списке ${options.length}`);
  check(options[0].textContent!.includes(velocity.name), "в списке — velocity");
  (options[0] as unknown as HTMLElement).click();
  check(root.textContent!.includes("Этап 1 из 2"), "клик по теме открыл этап 1 обучения");
  learning.close();
}

// ---------------------------------------------------------------------------
// 3. Граф заклинаний: статусы узлов и детали.
// ---------------------------------------------------------------------------
{
  const nodeFor = (root: HTMLElement, name: string): HTMLElement | null =>
    (Array.from(root.querySelectorAll(".graph-node")) as unknown as HTMLElement[]).find((n) => n.textContent!.includes(name)) ?? null;

  const root = freshRoot();
  const gs = new GameState();
  const graph = new SpellGraphScreen(root, gs);

  graph.open();
  let node = nodeFor(root, velocity.name)!;
  check(!!node && node.classList.contains("needs-material"), "без материалов тема из корня дерева — «нужны материалы»");
  check(nodeFor(root, flame.name)!.classList.contains("locked"), "тема с неизученным пререквизитом — заблокирована");
  check(root.textContent!.includes("📖 ✗ · 📄 0/6"), "шапка школы земли: книги нет, страниц 0/6");
  node.click();
  check(root.textContent!.includes("Нужны материалы"), "детали: статус «нужны материалы»");
  check(root.textContent!.includes("Страница: не найдена"), "детали: страница не найдена");
  graph.close();

  gs.collectBook(earthBookId);
  gs.collectBookPage(pageIdOfSpell("velocity"));
  graph.open();
  node = nodeFor(root, velocity.name)!;
  check(node.classList.contains("unlockable"), "с материалами тема — «доступна»");
  check(root.textContent!.includes("📖 ✓ · 📄 1/6"), "шапка школы земли: книга есть, страница 1/6");
  node.click();
  check(root.textContent!.includes("Доступно — найди костёр"), "детали: можно изучать у костра");
  graph.close();

  gs.learn("velocity");
  graph.open();
  check(nodeFor(root, velocity.name)!.classList.contains("learned"), "изученная тема — «learned»");
  graph.close();

  check(ALL_SPELLS.length > 0, "данные заклинаний загружены");
}

if (failures === 0) {
  console.log(`Проверок: ${checks}, провалов: 0`);
  console.log("OK: UI книг и страниц — окно находок, меню костра и граф заклинаний");
} else {
  console.error(`Проверок: ${checks}, провалов: ${failures}`);
  console.error("FAILED: UI книг и страниц");
  process.exit(1);
}
