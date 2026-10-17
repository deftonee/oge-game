import { ALL_SPELLS, Spell } from "../data/spells";
import { ALL_BOOKS, ChestLoot, booksRequiredFor, pageIdOfSpell } from "../data/books";
import type { GameState } from "../core/GameState";

/**
 * Что лежит в сундуке.
 *
 * Мир генерируется целиком при старте, когда игрок ещё ничего не нашёл, поэтому
 * содержимое ПРОЦЕДУРНЫХ сундуков не зашивается в мир заранее — в спеке
 * хранится только число «слотов» (ChestSpec.dynamic), а конкретные книги и
 * страницы выбираются в момент открытия из состояния игрока и запоминаются в
 * GameState (recordChestLoot). Отсюда три гарантии:
 *   - дублей нет: сундук никогда не выдаёт то, что у игрока уже есть;
 *   - тупиков нет: пропущенный сундук не «сжигает» нужную страницу — она просто
 *     достанется из следующего;
 *   - порядок разумный (см. nextSpellToFind): сначала самое простое, и страница
 *     никогда не выпадает раньше книги своей школы.
 *
 * Рукописные сундуки (ChestSpec с bookIds/pageIds, например вводные) отдают ровно
 * то, что в них указано.
 */

/** Слотов в обычном сундуке секции: хватает на книгу + страницу или на две страницы. */
export const CORRIDOR_CHEST_SLOTS = 2;
/** Сундук в боковой нише — награда за бой с охранницей, поэтому щедрее. */
export const SPUR_CHEST_SLOTS = 3;

/** Что нужно знать о сундуке, чтобы определить его содержимое (подмножество ChestSpec). */
export interface ChestContentSource {
  bookIds: readonly string[];
  pageIds: readonly string[];
  dynamic?: { slots: number };
}

/** Содержимое сундука по его спеке: точное (рукописное) либо подобранное под игрока. */
export function resolveChestLoot(source: ChestContentSource, gameState: GameState): ChestLoot {
  if (source.dynamic) return pickChestLoot(gameState, source.dynamic.slots);
  return { bookIds: [...source.bookIds], pageIds: [...source.pageIds] };
}

/**
 * Подбирает до `slots` предметов (книга или страница — каждый занимает слот),
 * которых у игрока ещё нет. Каждый шаг берёт «следующее по программе» заклинание;
 * если для него не хватает книги школы — в сундук кладётся книга, иначе страница.
 */
export function pickChestLoot(gameState: GameState, slots: number): ChestLoot {
  const books: string[] = [];
  const pages: string[] = [];

  const hasBook = (id: string): boolean => gameState.hasBook(id) || books.includes(id);
  const hasPage = (id: string): boolean => gameState.hasBookPage(id) || pages.includes(id);

  for (let left = slots; left > 0; left--) {
    const spell = nextSpellToFind(gameState, hasPage);
    if (!spell) break;
    const missingBook = booksRequiredFor(spell).find((b) => !hasBook(b.id));
    if (missingBook) books.push(missingBook.id);
    else pages.push(pageIdOfSpell(spell.id));
  }
  return { bookIds: books, pageIds: pages };
}

/** Есть ли ещё что находить в сундуках (иначе новые сундуки в мир не ставим). */
export function hasLootToFind(gameState: GameState): boolean {
  const loot = pickChestLoot(gameState, 1);
  return loot.bookIds.length + loot.pageIds.length > 0;
}

/**
 * Следующее заклинание, материалы к которому стоит найти. Кандидат: ещё не
 * изучено, страницы нет, школа открыта, а страницы пререквизитов уже найдены
 * (или пререквизиты изучены) — то есть игрок сможет когда-нибудь им воспользоваться.
 *
 * Порядок: сначала простые (тир), затем — из школы, у которой найдено меньше
 * страниц (так игрок получает материалы для разных веток по очереди), затем по
 * порядку объявления в данных. Порядок детерминирован.
 */
function nextSpellToFind(gameState: GameState, hasPage: (pageId: string) => boolean): Spell | undefined {
  const pagesInSchool = (schoolId: string): number =>
    ALL_BOOKS.find((b) => b.schoolId === schoolId)?.pages.filter((p) => hasPage(p.id)).length ?? 0;

  const reachable = (spell: Spell): boolean =>
    spell.prerequisites.every((id) => gameState.isLearned(id) || hasPage(pageIdOfSpell(id)));

  const order = new Map(ALL_SPELLS.map((s, i) => [s.id, i]));

  const candidates = ALL_SPELLS.filter(
    (s) =>
      !gameState.isLearned(s.id) &&
      !hasPage(pageIdOfSpell(s.id)) &&
      gameState.isSchoolUnlocked(s.school) &&
      reachable(s)
  );
  if (candidates.length === 0) return undefined;

  return candidates.sort(
    (a, b) =>
      a.tier - b.tier ||
      pagesInSchool(a.school) - pagesInSchool(b.school) ||
      order.get(a.id)! - order.get(b.id)!
  )[0];
}
