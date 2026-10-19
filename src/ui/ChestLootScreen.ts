import type { ChestContents } from "../entities/Chest";
import type { GameState } from "../core/GameState";
import { getSchoolById, getSpellById } from "../data/spells";
import { BOOK_NOTE, learnHint, learnHintText } from "./loot/lootItems";

/**
 * Окно «Найдено в сундуке»: что за предметы выпали и что они дают.
 * Для каждой страницы подсказывает, можно ли заклинание изучить у костра уже
 * сейчас или чего ещё не хватает (книги школы / изученных пререквизитов) —
 * так игрок понимает, зачем ему эти листки.
 */
export class ChestLootScreen {
  private overlay: HTMLElement | null = null;

  constructor(private uiRoot: HTMLElement, private gameState: GameState) {}

  public get isOpen(): boolean {
    return this.overlay !== null;
  }

  public close(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  public show(contents: ChestContents): void {
    this.close();

    const overlay = document.createElement("div");
    overlay.className = "bonfire-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.close();
    });

    const panel = document.createElement("div");
    panel.className = "bonfire-panel";

    const header = document.createElement("div");
    header.className = "bonfire-header";
    header.innerHTML = `<div class="bonfire-title">🧰 Сундук</div>`;
    const closeBtn = document.createElement("button");
    closeBtn.className = "graph-close";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => this.close());
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const isEmpty = contents.books.length === 0 && contents.pages.length === 0;
    if (isEmpty) {
      const empty = document.createElement("div");
      empty.className = "bonfire-empty";
      empty.textContent = "Сундук пуст — всё, что здесь можно было найти, у тебя уже есть.";
      panel.appendChild(empty);
    } else {
      const intro = document.createElement("div");
      intro.className = "bonfire-intro";
      intro.textContent = "Ты нашёл:";
      panel.appendChild(intro);

      const list = document.createElement("div");
      list.className = "bonfire-list";

      for (const book of contents.books) {
        const school = getSchoolById(book.schoolId);
        const item = document.createElement("div");
        item.className = "loot-item loot-book";
        item.style.borderColor = school.color;
        item.innerHTML = `
          <div class="bonfire-spell-name" style="color:${school.color}">📖 ${book.title}</div>
          <div class="bonfire-spell-law">Ветка прокачки: ${school.icon} ${school.name}</div>
          <div class="loot-note">${BOOK_NOTE}</div>
        `;
        list.appendChild(item);
      }

      for (const page of contents.pages) {
        const spell = getSpellById(page.spellId);
        const item = document.createElement("div");
        item.className = "loot-item loot-page";
        item.style.borderColor = spell.color;

        const hint = learnHint(spell, this.gameState);
        const note = `<span class="${hint.ok ? "loot-ok" : "loot-wait"}">${learnHintText(hint)}</span>`;

        item.innerHTML = `
          <div class="bonfire-spell-name" style="color:${spell.color}">📄 Страница «${spell.name}»</div>
          <div class="bonfire-spell-law">${spell.law}</div>
          <div class="bonfire-spell-formula">${spell.formula}</div>
          <div class="loot-note">${note}</div>
        `;
        list.appendChild(item);
      }
      panel.appendChild(list);
    }

    const okBtn = document.createElement("button");
    okBtn.className = "combat-submit";
    okBtn.textContent = "Забрать";
    okBtn.addEventListener("click", () => this.close());
    panel.appendChild(okBtn);

    overlay.appendChild(panel);
    this.uiRoot.appendChild(overlay);
    this.overlay = overlay;
  }
}
