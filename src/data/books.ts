/**
 * Обучающие книги и страницы.
 *
 * Это только данные: entity сундука не знает ничего о конкретном содержимом.
 * Благодаря этому книги можно будет расширять без изменения Chest.ts.
 */
export interface BookPage {
  id: string;
  bookId: string;
  title: string;
  text: string;
}

export interface Book {
  id: string;
  title: string;
  description: string;
  pages: BookPage[];
}

export const ALL_BOOKS: Book[] = [
  {
    id: "mechanics_basics",
    title: "Основы механики",
    description: "Первые страницы о движении и силах.",
    pages: [
      {
        id: "mechanics_speed",
        bookId: "mechanics_basics",
        title: "Скорость",
        text: "Скорость показывает, как быстро меняется положение тела.",
      },
      {
        id: "mechanics_acceleration",
        bookId: "mechanics_basics",
        title: "Ускорение",
        text: "Ускорение показывает, как быстро меняется скорость.",
      },
      {
        id: "mechanics_newton_2",
        bookId: "mechanics_basics",
        title: "Второй закон Ньютона",
        text: "Результирующая сила связана с массой и ускорением тела.",
      },
    ],
  },
];

export function getBookById(id: string): Book | undefined {
  return ALL_BOOKS.find((book) => book.id === id);
}

export function getBookPageById(id: string): BookPage | undefined {
  for (const book of ALL_BOOKS) {
    const page = book.pages.find((candidate) => candidate.id === id);
    if (page) return page;
  }
  return undefined;
}
