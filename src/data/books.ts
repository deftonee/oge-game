/**
 * Книги и страницы — материалы для изучения заклинаний.
 *
 * Модель (выводится из данных заклинаний, вручную ничего не заводится):
 *   книга    = ветка прокачки (школа). Одна книга на каждую школу, в которой есть
 *              заклинания: `book-<schoolId>`;
 *   страница = одно заклинание. Одна страница на каждое заклинание:
 *              `page-<spellId>`, лежит в книге его ОСНОВНОЙ школы.
 *
 * Чтобы изучить заклинание у костра, игроку нужны (см. GameState.canLearn):
 *   1) книга своей школы (у моста — книги ВСЕХ его школ),
 *   2) страница этого заклинания,
 *   3) изученные пререквизиты (как и раньше).
 * Книги и страницы игрок находит в сундуках (см. learning/chestLoot.ts).
 *
 * Добавил заклинание в JSON → у него сама появилась страница; добавил школу
 * с заклинаниями → сама появилась книга.
 */
import { ALL_SCHOOLS, ALL_SPELLS, Spell } from "./spells";

export interface BookPage {
  id: string;
  bookId: string;
  spellId: string;
  title: string;
  text: string;
}

export interface Book {
  id: string;
  schoolId: string;
  title: string;
  description: string;
  pages: BookPage[];
}

/** Содержимое сундука: id книг и страниц. */
export interface ChestLoot {
  bookIds: string[];
  pageIds: string[];
}

export function bookIdOfSchool(schoolId: string): string {
  return `book-${schoolId}`;
}

export function pageIdOfSpell(spellId: string): string {
  return `page-${spellId}`;
}

function buildBooks(): Book[] {
  const books: Book[] = [];
  for (const school of ALL_SCHOOLS) {
    // Порядок страниц — порядок изучения (тир), при равенстве — порядок объявления.
    const spells = ALL_SPELLS.filter((s) => s.school === school.id).sort((a, b) => a.tier - b.tier);
    // Школа без заклинаний книги не получает: класть в сундук нечего.
    if (spells.length === 0) continue;

    const id = bookIdOfSchool(school.id);
    books.push({
      id,
      schoolId: school.id,
      title: `Книга «${school.pathName}»`,
      description: `${school.icon} ${school.name}. ${school.description}`.trim(),
      pages: spells.map((s) => ({
        id: pageIdOfSpell(s.id),
        bookId: id,
        spellId: s.id,
        title: s.name,
        text: `${s.law}: ${s.formula}`,
      })),
    });
  }
  return books;
}

export const ALL_BOOKS: readonly Book[] = buildBooks();

export function getBookById(id: string): Book | undefined {
  return ALL_BOOKS.find((book) => book.id === id);
}

export function getBookBySchool(schoolId: string): Book | undefined {
  return getBookById(bookIdOfSchool(schoolId));
}

export function getBookPageById(id: string): BookPage | undefined {
  for (const book of ALL_BOOKS) {
    const page = book.pages.find((candidate) => candidate.id === id);
    if (page) return page;
  }
  return undefined;
}

export function getPageBySpell(spellId: string): BookPage | undefined {
  return getBookPageById(pageIdOfSpell(spellId));
}

/** Книги, без которых заклинание не изучить: по одной на каждую школу заклинания (у моста — две). */
export function booksRequiredFor(spell: Spell): Book[] {
  return spell.schools.map((id) => getBookBySchool(id)).filter((b): b is Book => !!b);
}
