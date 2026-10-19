import type { ChestContents } from "../../entities/Chest";
import type { GameState } from "../../core/GameState";
import { getBookById } from "../../data/books";
import { getSchoolById, getSpellById, schoolOf } from "../../data/spells";
import type { Spell } from "../../data/spells";

/**
 * Модель «находки» для интерфейса: плоские данные, готовые к показу. Окно
 * находок и презентация строятся из одного и того же описания и одной и той же
 * подсказки про изучение — текст и логика не дублируются.
 */

/** Можно ли изучить заклинание у костра сейчас, а если нет — чего не хватает. */
export interface LearnHint {
  ok: boolean;
  reasons: string[];
}

export function learnHint(spell: Spell, gameState: GameState): LearnHint {
  if (gameState.canLearn(spell)) return { ok: true, reasons: [] };
  const reasons: string[] = [];
  for (const book of gameState.missingBooks(spell)) reasons.push(`книга «${getSchoolById(book.schoolId).pathName}»`);
  for (const pre of gameState.missingPrerequisites(spell)) reasons.push(`изучить «${pre.name}»`);
  return { ok: false, reasons };
}

export function learnHintText(hint: LearnHint): string {
  return hint.ok ? "✔ Можно изучить у костра" : `Пока нужно: ${hint.reasons.join(", ") || "—"}`;
}

/** Что даёт книга — одна и та же подпись везде, где книга показывается. */
export const BOOK_NOTE = "Теперь заклинания этой школы можно изучать — осталось найти их страницы.";

interface LootItemBase {
  id: string;
  /** Акцентный цвет (hex): цвет школы. */
  accent: string;
  /** Эмодзи школы. */
  icon: string;
}

export interface BookLootItem extends LootItemBase {
  kind: "book";
  title: string;
  schoolName: string;
  pathName: string;
  note: string;
}

export interface PageLootItem extends LootItemBase {
  kind: "page";
  spellName: string;
  law: string;
  formula: string;
  /** Номер страницы в своей книге и сколько всего страниц в ней. */
  folio: number;
  folioTotal: number;
  bookTitle: string;
  hint: LearnHint;
}

export type LootItem = BookLootItem | PageLootItem;

/** Книги, затем страницы — в том же порядке, что и в окне находок. */
export function buildLootItems(contents: ChestContents, gameState: GameState): LootItem[] {
  const items: LootItem[] = [];

  for (const book of contents.books) {
    const school = getSchoolById(book.schoolId);
    items.push({
      kind: "book",
      id: book.id,
      accent: school.color,
      icon: school.icon,
      title: book.title,
      schoolName: school.name,
      pathName: school.pathName,
      note: BOOK_NOTE,
    });
  }

  for (const page of contents.pages) {
    const spell = getSpellById(page.spellId);
    const book = getBookById(page.bookId);
    const index = book ? book.pages.findIndex((p) => p.id === page.id) : -1;
    items.push({
      kind: "page",
      id: page.id,
      accent: spell.color,
      icon: schoolOf(spell).icon,
      spellName: spell.name,
      law: spell.law,
      formula: spell.formula,
      folio: index >= 0 ? index + 1 : 1,
      folioTotal: book?.pages.length ?? 1,
      bookTitle: book?.title ?? "",
      hint: learnHint(spell, gameState),
    });
  }
  return items;
}
