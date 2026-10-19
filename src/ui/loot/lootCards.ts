import { mixHex, shadeHex } from "../../core/color";
import { el } from "../dom";
import type { BookLootItem, LootItem, PageLootItem } from "./lootItems";
import { learnHintText } from "./lootItems";

/**
 * DOM-карточки находок. Каждый вид предмета — своя функция-«рисовальщик»,
 * реестр RENDERERS сопоставляет их виду (kind): новый вид находки — это новая
 * функция и одна строка в реестре, остальной код не меняется.
 *
 * Вся вёрстка в em: размер карточки задаёт презентер через font-size, всё
 * остальное масштабируется вместе с ней. Тексты — только через textContent.
 */

export interface CardContext {
  /** Data-URL текстуры бумаги (render/parchment) или null — тогда CSS рисует запасной градиент. */
  parchmentUrl: string | null;
}

function setPalette(card: HTMLElement, accent: string): void {
  const cover = shadeHex(accent, 0.55);
  card.style.setProperty("--accent", accent);
  card.style.setProperty("--cover", cover);
  card.style.setProperty("--cover-dark", shadeHex(accent, 0.34));
  card.style.setProperty("--cover-light", mixHex(cover, "#ffffff", 0.16));
}

function renderBookCard(item: BookLootItem): HTMLElement {
  const card = el("div", "loot-card loot-card--book");
  card.setAttribute("role", "img");
  card.setAttribute("aria-label", item.title);
  setPalette(card, item.accent);

  card.appendChild(el("div", "loot-book__block")); // срез страниц, выглядывает справа и снизу

  const cover = el("div", "loot-book__cover");
  const spine = el("div", "loot-book__spine");
  for (let i = 0; i < 3; i++) spine.appendChild(el("i"));
  cover.appendChild(spine);

  const face = el("div", "loot-book__face");
  const frame = el("div", "loot-book__frame");
  frame.appendChild(el("div", "loot-book__crest", item.icon));
  frame.appendChild(el("div", "loot-book__title", item.title));
  frame.appendChild(el("div", "loot-book__school", `${item.schoolName} · ${item.pathName}`));
  frame.appendChild(el("div", "loot-book__orn", "✦ ✦ ✦"));
  frame.appendChild(el("div", "loot-book__note", item.note));
  face.appendChild(frame);
  cover.appendChild(face);

  const strap = el("div", "loot-book__strap");
  strap.appendChild(el("b"));
  cover.appendChild(strap);
  card.appendChild(cover);
  return card;
}

function renderPageCard(item: PageLootItem, ctx: CardContext): HTMLElement {
  const card = el("div", "loot-card loot-card--page");
  card.setAttribute("role", "img");
  card.setAttribute("aria-label", `Страница «${item.spellName}»`);
  setPalette(card, item.accent);

  const paper = el("div", "loot-page__paper");
  if (ctx.parchmentUrl) paper.style.backgroundImage = `url("${ctx.parchmentUrl}")`;

  const frame = el("div", "loot-page__frame");
  frame.appendChild(el("div", "loot-page__eyebrow", `Страница ${item.folio} из ${item.folioTotal}`));
  if (item.bookTitle) frame.appendChild(el("div", "loot-page__book", item.bookTitle));

  // Буквица: первая буква названия крупно и цветом школы — как в рукописных книгах.
  const title = el("h2", "loot-page__title");
  const first = item.spellName.charAt(0);
  title.appendChild(el("span", "loot-page__initial", first));
  title.appendChild(document.createTextNode(item.spellName.slice(1)));
  frame.appendChild(title);

  frame.appendChild(el("div", "loot-page__rule", "❦"));
  frame.appendChild(el("p", "loot-page__law", item.law));
  frame.appendChild(el("div", "loot-page__formula", item.formula));
  frame.appendChild(el("div", `loot-page__hint ${item.hint.ok ? "loot-ok" : "loot-wait"}`, learnHintText(item.hint)));
  frame.appendChild(el("div", "loot-page__seal", item.icon));
  frame.appendChild(el("div", "loot-page__folio", `— ${item.folio} —`));

  paper.appendChild(frame);
  card.appendChild(paper);
  return card;
}

type Renderers = { [K in LootItem["kind"]]: (item: Extract<LootItem, { kind: K }>, ctx: CardContext) => HTMLElement };

const RENDERERS: Renderers = {
  book: renderBookCard,
  page: renderPageCard,
};

export function renderLootCard(item: LootItem, ctx: CardContext): HTMLElement {
  const render = RENDERERS[item.kind] as (item: LootItem, ctx: CardContext) => HTMLElement;
  return render(item, ctx);
}
