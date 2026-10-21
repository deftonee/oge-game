import type { GameState } from "../../core/GameState";
import { ALL_BOOKS } from "../../data/books";
import { ALL_SPELLS, getSchoolById } from "../../data/spells";
import { el } from "../dom";
import { createSpellGraphView } from "../SpellGraphView";

/**
 * Инвентарь в меню паузы: что собрано (книги школ и страницы к ним) и дерево
 * уже изученных заклинаний. Дерево рисует тот же код, что и граф по клавише G,
 * только в режиме «learned» — без недоступных веток.
 */
export function renderInventory(gameState: GameState): HTMLElement {
  const pane = el("div", "pause-inventory");

  pane.appendChild(el("h3", "pause-title", "Инвентарь"));
  const materials = el("div", "pause-materials");
  for (const book of ALL_BOOKS) {
    const school = getSchoolById(book.schoolId);
    const has = gameState.hasBook(book.id);
    const pages = book.pages.filter((p) => gameState.hasBookPage(p.id)).length;

    const chip = el("div", `pause-chip${has ? " is-have" : ""}`);
    chip.style.borderColor = has ? school.color : "";
    chip.appendChild(el("div", "pause-chip-title", `${school.icon} ${book.title}`));
    chip.appendChild(el("div", "pause-chip-meta", `📖 ${has ? "найдена" : "не найдена"} · 📄 ${pages}/${book.pages.length}`));
    materials.appendChild(chip);
  }
  pane.appendChild(materials);

  const learned = ALL_SPELLS.filter((s) => gameState.isLearned(s.id)).length;
  pane.appendChild(el("h3", "pause-title", `Изученные заклинания · ${learned} из ${ALL_SPELLS.length}`));
  pane.appendChild(createSpellGraphView(gameState, "learned").element);
  return pane;
}
