// Презентация находок: хронология полёта (чистая математика), модель предметов,
// карточки, презентер (очередь, ускорение, Esc, повторный вход), пул искр,
// текстура бумаги, проекция мира на экран и точка вылета из сундука.
import { Window } from "happy-dom";
import { FreeCamera, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { GameState } from "../src/core/GameState";
import { QUALITY_PROFILES } from "../src/core/quality";
import { ScreenProjector } from "../src/core/screenProjection";
import { Chest } from "../src/entities/Chest";
import { ALL_BOOKS, bookIdOfSchool, getBookById, getBookPageById, pageIdOfSpell } from "../src/data/books";
import { getSpellById } from "../src/data/spells";
import { parchmentDataUrl } from "../src/ui/parchment";
import { renderLootCard } from "../src/ui/loot/lootCards";
import { LootPresenter } from "../src/ui/loot/LootPresenter";
import type { LootRoute } from "../src/ui/loot/LootPresenter";
import { buildLootItems, learnHint, learnHintText } from "../src/ui/loot/lootItems";
import type { LootItem, PageLootItem } from "../src/ui/loot/lootItems";
import { SparkField } from "../src/ui/loot/SparkField";
import {
  EMERGE_SECONDS,
  FLY_SECONDS,
  HOLD_SECONDS,
  ITEM_SECONDS,
  lootPoseAt,
  newPose,
} from "../src/ui/loot/lootTimeline";
import type { LootPath } from "../src/ui/loot/lootTimeline";

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
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

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

// ---------------------------------------------------------------------------
// Подмена canvas: happy-dom не умеет 2D-контекст, а искрам и бумаге он нужен.
// ---------------------------------------------------------------------------
interface FakeCtx {
  draws: number;
  clears: number;
  image: { data: Uint8ClampedArray; width: number; height: number } | null;
  [key: string]: unknown;
}
function installFakeCanvas(): { restore(): void; canvasesCreated(): number } {
  const doc = win.document as unknown as { createElement: (tag: string) => unknown };
  const original = doc.createElement.bind(doc);
  let created = 0;
  doc.createElement = (tag: string) => {
    const node = original(tag) as Record<string, unknown>;
    if (tag === "canvas") {
      created++;
      const ctx: FakeCtx = {
        draws: 0,
        clears: 0,
        image: null,
        drawImage() {
          ctx.draws++;
        },
        clearRect() {
          ctx.clears++;
        },
        setTransform() {},
        fillRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        createRadialGradient: () => ({ addColorStop() {} }),
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData(img: FakeCtx["image"]) {
          ctx.image = img;
        },
      };
      node.getContext = () => ctx;
      node.toDataURL = () => "data:image/jpeg;base64,FAKE";
      node.__ctx = ctx;
    }
    return node;
  };
  return {
    restore: () => {
      doc.createElement = original;
    },
    canvasesCreated: () => created,
  };
}

// ---------------------------------------------------------------------------
// 1. Хронология: чистая математика
// ---------------------------------------------------------------------------
{
  const path: LootPath = { from: { x: 100, y: 500 }, center: { x: 500, y: 300 }, to: { x: 700, y: 600 }, arc: 100 };
  const tilt = 1.5;
  const p = (t: number, pth: LootPath = path) => ({ ...lootPoseAt(t, pth, tilt) });

  const start = p(0);
  check(near(start.x, 100) && near(start.y, 500) && start.opacity === 0 && start.phase === "emerge", "старт: в точке сундука, невидима");
  check(start.scale < 0.1, "старт: крошечная");

  const mid = p(EMERGE_SECONDS);
  check(near(mid.x, 500) && near(mid.y, 300) && near(mid.scale, 1, 1e-6) && mid.opacity === 1, "конец вылета: в центре, полный размер");
  check(near(mid.rotate, tilt), "конец вылета: повёрнута на свой лёгкий наклон");

  const end = p(ITEM_SECONDS + 1e-6); // на самой границе плавающая точка может дать w = 0.9999999
  check(near(end.x, 700) && near(end.y, 600) && end.opacity === 0 && end.phase === "done", "финиш: у рюкзака, невидима");
  const almost = p(ITEM_SECONDS - 1e-3);
  check(Math.hypot(almost.x - 700, almost.y - 600) < 3 && almost.opacity < 0.01, "незадолго до финиша карточка уже у рюкзака и почти невидима");
  check(p(ITEM_SECONDS + 5).phase === "done" && near(p(ITEM_SECONDS + 5).x, 700), "после конца поза не уплывает");
  check(ITEM_SECONDS >= 2 && ITEM_SECONDS <= 3.5, `предмет длится ${ITEM_SECONDS.toFixed(2)} с — «пара секунд»`);

  // Непрерывность на стыках фаз: нет скачков позиции/размера/поворота/прозрачности/свечения.
  const eps = 1e-4;
  for (const boundary of [EMERGE_SECONDS, EMERGE_SECONDS + HOLD_SECONDS]) {
    const a = p(boundary - eps);
    const b = p(boundary + eps);
    const jump = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.scale - b.scale) * 100, Math.abs(a.rotate - b.rotate), Math.abs(a.opacity - b.opacity) * 100, Math.abs(a.glow - b.glow) * 100);
    check(jump < 0.6, `стык фаз на ${boundary.toFixed(2)} с без скачков (макс. ${jump.toFixed(3)})`);
  }

  // Порядок фаз, конечность и допустимые диапазоны по всей длительности.
  const order = ["emerge", "hold", "fly", "done"];
  let lastPhase = 0;
  let sane = true;
  let monotonicFlight = true;
  let prevDist = Infinity;
  for (let t = 0; t <= ITEM_SECONDS + 0.2; t += 0.01) {
    const s = p(t);
    const idx = order.indexOf(s.phase);
    if (idx < lastPhase) sane = false;
    lastPhase = idx;
    if (![s.x, s.y, s.scale, s.rotate, s.opacity, s.glow].every(Number.isFinite) || s.opacity < 0 || s.opacity > 1 || s.scale <= 0 || s.glow < 0 || s.glow > 1.0001) sane = false;
    if (s.phase === "fly") {
      const d = Math.hypot(s.x - 700, s.y - 600 + 0); // расстояние до рюкзака в плоскости (дуга поднимает вверх — допуск ниже)
      if (d > prevDist + 70) monotonicFlight = false;
      prevDist = Math.min(prevDist, d);
    }
  }
  check(sane, "фазы идут по порядку, все величины конечны и в диапазонах");
  check(monotonicFlight, "в полёте карточка приближается к рюкзаку");

  // «Спокойный» режим: без дуг и кручения.
  const calm: LootPath = { ...path, calm: true };
  check(near(p(EMERGE_SECONDS * 0.5, calm).rotate, tilt - 0, 1e-6) || Math.abs(p(EMERGE_SECONDS * 0.5, calm).rotate - tilt) < 1e-6, "calm: вылет без кручения");
  check(near(p(EMERGE_SECONDS + HOLD_SECONDS + FLY_SECONDS * 0.8, calm).rotate, tilt), "calm: полёт без кручения");
  const straight = p(EMERGE_SECONDS * 0.5, calm);
  const linearY = 500 + (300 - 500) * (1 - Math.pow(1 - 0.5, 3));
  check(near(straight.y, linearY, 1e-6), "calm: вылет по прямой (без дуги)");
  check(p(EMERGE_SECONDS * 0.5).y < straight.y - 10, "обычный режим: вылет идёт по дуге вверх");

  const reuse = newPose();
  check(lootPoseAt(0.7, path, tilt, reuse) === reuse, "out переиспользуется (без аллокаций в кадре)");
}

// ---------------------------------------------------------------------------
// 2. Модель предметов
// ---------------------------------------------------------------------------
const earthBookId = bookIdOfSchool("earth");
const velocity = getSpellById("velocity");
{
  const gs = new GameState();
  check(buildLootItems({ books: [], pages: [] }, gs).length === 0, "пустое содержимое — нет предметов");

  const book = getBookById(earthBookId)!;
  const page = getBookPageById(pageIdOfSpell("velocity"))!;
  const items = buildLootItems({ books: [book], pages: [page] }, gs);
  check(items.length === 2 && items[0].kind === "book" && items[1].kind === "page", "порядок: книги, затем страницы");

  const pageItem = items[1] as PageLootItem;
  check(pageItem.id === page.id && pageItem.spellName === velocity.name && pageItem.law === velocity.law && pageItem.formula === velocity.formula, "данные страницы взяты у заклинания");
  check(pageItem.accent === velocity.color, "акцент страницы — цвет заклинания");
  check(pageItem.folio >= 1 && pageItem.folio <= pageItem.folioTotal && pageItem.folioTotal === book.pages.length, `номер страницы ${pageItem.folio} из ${pageItem.folioTotal}`);
  check(!pageItem.hint.ok && pageItem.hint.reasons.length > 0, "без книги изучить нельзя — подсказка называет причину");
  check(learnHintText(pageItem.hint).startsWith("Пока нужно:"), "текст подсказки «пока нужно»");

  gs.recordChestLoot("c", { bookIds: [earthBookId], pageIds: [page.id] });
  const hint = learnHint(velocity, gs);
  check(hint.ok && hint.reasons.length === 0 && learnHintText(hint) === "✔ Можно изучить у костра", "с книгой и страницей — можно изучить");
  check((buildLootItems({ books: [book], pages: [page] }, gs)[1] as PageLootItem).hint.ok, "карточки берут актуальную подсказку");
}

// ---------------------------------------------------------------------------
// 3. Карточки
// ---------------------------------------------------------------------------
{
  const gs = new GameState();
  const items = buildLootItems({ books: [getBookById(earthBookId)!], pages: [getBookPageById(pageIdOfSpell("velocity"))!] }, gs);

  const bookCard = renderLootCard(items[0], { parchmentUrl: null }) as unknown as HTMLElement;
  check(bookCard.className.includes("loot-card--book") && bookCard.textContent!.includes("Путь Странника"), "карточка книги: класс и название");
  check(bookCard.style.getPropertyValue("--accent") === items[0].accent && bookCard.style.getPropertyValue("--cover") !== "", "палитра книги задана переменными CSS");

  const pageCard = renderLootCard(items[1], { parchmentUrl: "data:image/jpeg;base64,AAAA" }) as unknown as HTMLElement;
  const text = pageCard.textContent!;
  check(pageCard.className.includes("loot-card--page"), "карточка страницы: класс");
  check(text.includes(velocity.formula) && text.includes(velocity.law), "на странице видны закон и формула");
  check(text.includes(`Страница ${(items[1] as PageLootItem).folio} из`), "подпись «Страница N из M»");
  const initial = pageCard.querySelector(".loot-page__initial");
  check(initial?.textContent === velocity.name.charAt(0), "буквица — первая буква названия");
  check((pageCard.querySelector(".loot-page__paper") as HTMLElement).style.backgroundImage.includes("data:image/jpeg"), "текстура бумаги подставлена");
  check(!!pageCard.querySelector(".loot-page__seal") && !!pageCard.querySelector(".loot-page__folio"), "есть печать и номер страницы");

  const noTexture = renderLootCard(items[1], { parchmentUrl: null }) as unknown as HTMLElement;
  check((noTexture.querySelector(".loot-page__paper") as HTMLElement).style.backgroundImage === "", "без текстуры — фон остаётся за CSS-градиентом");

  // Данные не интерпретируются как HTML.
  const evil: LootItem = { ...(items[0] as LootItem), title: '<img src=x onerror="alert(1)"><b>x</b>' } as LootItem;
  const evilCard = renderLootCard(evil, { parchmentUrl: null }) as unknown as HTMLElement;
  check(evilCard.querySelector("img") === null && evilCard.querySelector(".loot-book__title b") === null, "HTML в названии не превращается в элементы");
  check(evilCard.textContent!.includes("<img src=x"), "…а показывается как обычный текст");
}

// ---------------------------------------------------------------------------
// 4. Презентер
// ---------------------------------------------------------------------------
const FRAME = 1 / 60;
const gsForItems = new GameState();
const sampleBooks = [getBookById(earthBookId)!];
const samplePages = [getBookPageById(pageIdOfSpell("velocity"))!];
function sampleItems(): LootItem[] {
  return buildLootItems({ books: sampleBooks, pages: samplePages }, gsForItems);
}
function makeRoute() {
  const arrived: string[] = [];
  let fromCalls = 0;
  let toCalls = 0;
  const route: LootRoute = {
    from: () => (fromCalls++, { x: 100, y: 500 }),
    to: () => (toCalls++, { x: 700, y: 600 }),
    onArrive: (item) => arrived.push(item.id),
  };
  return { route, arrived, calls: () => ({ fromCalls, toCalls }) };
}
function runUntil(presenter: LootPresenter, cond: () => boolean, maxSeconds = 30): number {
  let frames = 0;
  while (!cond() && frames < maxSeconds * 60) {
    presenter.update(FRAME);
    frames++;
  }
  return frames * FRAME;
}
const q = QUALITY_PROFILES.low;

{
  const root = freshRoot();
  const presenter = new LootPresenter(root, { quality: q, reducedMotion: false });
  const { route, arrived, calls } = makeRoute();
  const items = sampleItems();

  check(!presenter.isActive && presenter.present([], route) === false, "пустой список — показ не начинается");
  check(presenter.present(items, route) === true && presenter.isActive, "показ начался");
  check(presenter.present(items, route) === false, "пока идёт показ, второй запуск отклоняется");
  check(root.querySelectorAll(".loot-overlay").length === 1, "оверлей один");
  check(root.querySelector(".loot-counter")!.textContent === `Находка 1 из ${items.length}`, "счётчик «Находка 1 из N»");
  check(root.querySelectorAll(".loot-actor").length === 1, "на экране одна карточка");
  check(calls().fromCalls === 1, "точка вылета запрошена при старте");
  check(presenter.remaining === items.length, "осталось столько же, сколько предметов");

  const t1 = runUntil(presenter, () => arrived.length === 1);
  check(Math.abs(t1 - ITEM_SECONDS) < 0.1, `первый предмет без ускорения занял ${t1.toFixed(2)} с (≈ ${ITEM_SECONDS.toFixed(2)})`);
  check(arrived[0] === items[0].id, "первым долетел первый предмет");
  check(calls().toCalls > 20, "цель (рюкзак) опрашивается каждый кадр полёта");
  check(root.querySelectorAll(".loot-actor").length === 0, "в паузе между предметами карточки нет");

  presenter.update(0.1);
  presenter.update(0.1); // dt зажимается до 0.1 с, поэтому паузу в 0.12 с проходим двумя кадрами
  check(root.querySelectorAll(".loot-actor").length === 1 && root.querySelector(".loot-counter")!.textContent === `Находка 2 из ${items.length}`, "после паузы вылетает следующий предмет");

  const t2 = runUntil(presenter, () => arrived.length === 2);
  check(Math.abs(t2 - ITEM_SECONDS) < 0.15, `второй предмет снова идёт с обычной скоростью (${t2.toFixed(2)} с)`);
  check(arrived.join() === items.map((i) => i.id).join(), "порядок прилёта = порядок предметов");

  check(presenter.isActive, "сразу после последнего предмета оверлей ещё гаснет");
  runUntil(presenter, () => !presenter.isActive, 2);
  check(!presenter.isActive && root.querySelector(".loot-overlay") === null, "после затухания оверлей убран из DOM");
  check(arrived.length === items.length, "каждый предмет долетел ровно один раз");

  win.dispatchEvent(new win.KeyboardEvent("keydown", { key: "x" }));
  presenter.update(1);
  check(arrived.length === items.length, "после показа слушатели клавиш сняты");
  check(presenter.present(items, route) === true, "после завершения можно запустить показ снова");
  presenter.dispose();
  check(!presenter.isActive && root.querySelector(".loot-overlay") === null, "dispose убирает оверлей");
}

// Ускорение любой клавишей / касанием, игнор повтора клавиши.
{
  const baseline = (() => {
    const p = new LootPresenter(freshRoot(), { quality: q, reducedMotion: false });
    const r = makeRoute();
    p.present(sampleItems(), r.route);
    const t = runUntil(p, () => r.arrived.length === 1);
    p.dispose();
    return t;
  })();

  const trial = (act: (p: LootPresenter, root: HTMLElement) => void): number => {
    const root = freshRoot();
    const p = new LootPresenter(root, { quality: q, reducedMotion: false });
    const r = makeRoute();
    p.present(sampleItems(), r.route);
    runUntil(p, () => false, 0.5); // 0.5 с обычного хода
    act(p, root);
    const t = runUntil(p, () => r.arrived.length === 1);
    p.dispose();
    return t;
  };

  const viaApi = trial((p) => p.accelerate());
  check(viaApi < (baseline - 0.5) / 3, `accelerate(): остаток ${viaApi.toFixed(2)} с вместо ${(baseline - 0.5).toFixed(2)} с`);
  const viaKey = trial(() => {
    win.dispatchEvent(new win.KeyboardEvent("keydown", { key: "x" }));
  });
  check(viaKey < (baseline - 0.5) / 3, `любая клавиша ускоряет (${viaKey.toFixed(2)} с)`);
  const viaKeyRepeat = trial(() => {
    win.dispatchEvent(new win.KeyboardEvent("keydown", { key: "e", repeat: true }));
  });
  check(Math.abs(viaKeyRepeat - (baseline - 0.5)) < 0.1, "удержание клавиши (repeat) не ускоряет — E, открывшая сундук, не пролистывает показ");
  const viaPointer = trial((_p, root) => {
    root.querySelector(".loot-overlay")!.dispatchEvent(new win.PointerEvent("pointerdown", { bubbles: true }));
  });
  check(viaPointer < (baseline - 0.5) / 3, `касание экрана ускоряет (${viaPointer.toFixed(2)} с)`);
}

// Esc: пропуск всего без потерь и дублей.
{
  const root = freshRoot();
  const p = new LootPresenter(root, { quality: q, reducedMotion: false });
  const r = makeRoute();
  const items = sampleItems();
  p.present(items, r.route);
  runUntil(p, () => false, 1.0);
  win.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape" }));
  check(!p.isActive && root.querySelector(".loot-overlay") === null, "Esc сразу закрывает показ");
  check(r.arrived.join() === items.map((i) => i.id).join(), "Esc: все предметы «долетели» по одному разу и по порядку");
  p.update(1);
  check(r.arrived.length === items.length, "после Esc повторных прилётов нет");
  p.dispose();

  // Esc на паузе между предметами: текущий уже долетел, остальные добираются.
  const p2 = new LootPresenter(freshRoot(), { quality: q, reducedMotion: false });
  const r2 = makeRoute();
  p2.present(items, r2.route);
  runUntil(p2, () => r2.arrived.length === 1);
  p2.skipAll();
  check(r2.arrived.length === items.length && new Set(r2.arrived).size === items.length, "skipAll на паузе: без дублей");
  p2.dispose();

  // dispose посреди показа: ничего не вызывается и не течёт.
  const p3 = new LootPresenter(freshRoot(), { quality: q, reducedMotion: false });
  const r3 = makeRoute();
  p3.present(items, r3.route);
  runUntil(p3, () => false, 0.5);
  p3.dispose();
  p3.update(5);
  check(!p3.isActive && r3.arrived.length === 0, "dispose посреди показа: прилётов нет, оверлея нет");
}

// Защита от лагов и режим «спокойного» движения.
{
  const p = new LootPresenter(freshRoot(), { quality: q, reducedMotion: false });
  const r = makeRoute();
  p.present(sampleItems(), r.route);
  p.update(10); // кадр «завис» на 10 секунд
  check(p.isActive && r.arrived.length === 0, "огромный dt не проматывает показ (зажат)");
  p.dispose();

  const calmRoot = freshRoot();
  const calmP = new LootPresenter(calmRoot, { quality: QUALITY_PROFILES.high, reducedMotion: true });
  const rc = makeRoute();
  calmP.present(sampleItems(), rc.route);
  check(calmRoot.querySelector(".loot-sparks") === null, "reduced-motion: искр нет");
  const tc = runUntil(calmP, () => rc.arrived.length === 1);
  check(tc < ITEM_SECONDS * 0.8, `reduced-motion: показ короче (${tc.toFixed(2)} с)`);
  calmP.dispose();
}

// ---------------------------------------------------------------------------
// 5. Пул искр (с подменой canvas)
// ---------------------------------------------------------------------------
{
  const fake = installFakeCanvas();
  const root = freshRoot();
  const field = new SparkField(root, { count: 10, resolutionScale: 0.5 });
  check(field.enabled && field.poolCapacity === 40, `пул искр ограничен (${field.poolCapacity})`);
  const canvas = root.querySelector("canvas") as HTMLCanvasElement;
  check(canvas.width === 512 && canvas.height === 384, `канвас искр в половинном разрешении (${canvas.width}×${canvas.height})`);

  field.burst(100, 100, 1000);
  check(field.liveCount === 40, "burst не выходит за пул");
  field.ring(100, 100, 50, 80, 1000);
  check(field.liveCount === 40, "ring при полном пуле тоже не растит память");

  const ctx = (canvas as unknown as { __ctx: FakeCtx }).__ctx;
  const drawsBefore = ctx.draws;
  field.update(0.016);
  check(ctx.draws - drawsBefore === 40, "каждая живая искра рисуется один раз за кадр");
  for (let i = 0; i < 60; i++) field.update(0.05);
  check(field.liveCount === 0, "искры сгорают сами");
  const clearsBefore = ctx.clears;
  field.update(0.05);
  field.update(0.05);
  check(ctx.clears - clearsBefore <= 1, "в простое канвас не перерисовывается каждый кадр");

  field.drift(10, 10, 5);
  check(field.liveCount === 5, "drift рождает указанное число искр");
  field.clear();
  check(field.liveCount === 0, "clear очищает пул");
  field.setAccent("#c9a24a");
  field.dispose();
  check(root.querySelector("canvas") === null, "dispose убирает канвас");

  const off = new SparkField(freshRoot(), { count: 0, resolutionScale: 1 });
  off.burst(1, 1, 10);
  off.update(0.1);
  check(!off.enabled && off.canvas === null && off.liveCount === 0 && off.poolCapacity === 0, "count = 0 — искры выключены полностью");

  // Парчмент на подменённом canvas.
  const before = fake.canvasesCreated();
  const url = parchmentDataUrl({ width: 64, height: 80 });
  check(url === "data:image/jpeg;base64,FAKE", "текстура бумаги отдана как data-URL");
  check(fake.canvasesCreated() === before + 1, "текстура рисуется один раз");
  check(parchmentDataUrl({ width: 64, height: 80 }) === url && fake.canvasesCreated() === before + 1, "повторный запрос берётся из кэша");
  fake.restore();
}

// Содержимое текстуры бумаги: тёплая, края темнее центра.
{
  let captured: FakeCtx["image"] = null;
  const fake = installFakeCanvas();
  const doc = win.document as unknown as { createElement: (tag: string) => Record<string, unknown> };
  const wrapped = doc.createElement;
  doc.createElement = (tag: string) => {
    const node = wrapped(tag);
    if (tag === "canvas") {
      const ctx = (node.getContext as () => FakeCtx)();
      const put = ctx.putImageData as (img: FakeCtx["image"]) => void;
      ctx.putImageData = (img: FakeCtx["image"]) => {
        captured = img;
        put(img);
      };
    }
    return node;
  };
  parchmentDataUrl({ width: 48, height: 60 });
  check(captured !== null, "пиксели бумаги сформированы");
  if (captured) {
    const { data, width, height } = captured as NonNullable<FakeCtx["image"]>;
    const lum = (x: number, y: number): number => {
      const i = (y * width + x) * 4;
      return 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
    };
    let centre = 0;
    let rim = 0;
    let nc = 0;
    let nr = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const edge = Math.min(x, width - 1 - x, y, height - 1 - y);
        if (edge >= 14) {
          centre += lum(x, y);
          nc++;
        } else if (edge <= 1) {
          rim += lum(x, y);
          nr++;
        }
      }
    }
    check(rim / nr < centre / nc - 15, `края бумаги темнее центра (${(rim / nr).toFixed(0)} < ${(centre / nc).toFixed(0)})`);
    const mid = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    check(data[mid] > data[mid + 1] && data[mid + 1] > data[mid + 2] && data[mid + 3] === 255, "центр — тёплый непрозрачный тон бумаги (R > G > B)");
  }
  fake.restore();
}

// Без 2D-контекста (happy-dom) всё деградирует тихо.
{
  const field = new SparkField(freshRoot(), { count: 10, resolutionScale: 1 });
  check(!field.enabled && field.canvas === null, "нет 2D-контекста — искры отключены без ошибок");
  check(parchmentDataUrl({ width: 33, height: 33 }) === null, "нет 2D-контекста — бумага рисуется CSS-градиентом (null)");
}

// ---------------------------------------------------------------------------
// 6. Проекция мира на экран и точка вылета из сундука
// ---------------------------------------------------------------------------
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new FreeCamera("cam", new Vector3(0, 0, -10), scene);
  camera.setTarget(Vector3.Zero());
  scene.activeCamera = camera;
  scene.render();

  const rect = { left: 100, top: 50, width: 800, height: 400 };
  const projector = new ScreenProjector(scene, camera, engine, () => rect);
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  const centre = projector.pointOf(Vector3.Zero());
  check(near(centre.x, cx, 1) && near(centre.y, cy, 1), "точка перед камерой проецируется в центр холста");
  const right = projector.pointOf(new Vector3(1, 0, 0));
  const up = projector.pointOf(new Vector3(0, 1, 0));
  check(right.x > cx + 5 && near(right.y, cy, 1), "точка правее — правее на экране");
  check(up.y < cy - 5 && near(up.x, cx, 1), "точка выше — выше на экране (y растёт вниз)");

  const behind = projector.pointOf(new Vector3(0, 0, -30));
  check(near(behind.x, cx, 1) && behind.y > cy, "точка за камерой — безопасная точка внизу по центру");
  const far = projector.pointOf(new Vector3(500, 0, 0));
  check(far.x <= rect.left + rect.width - 20 && far.x >= rect.left + rect.width - 30, "точка далеко за краем зажимается у границы с отступом");

  const into = { x: 0, y: 0 };
  check(projector.pointOf(Vector3.Zero(), into) === into, "результат пишется в переданный объект (без аллокаций)");

  // Рендер-буфер ≠ CSS-размеру (hardware scaling): центр остаётся центром, пропорции сохраняются.
  const doubled = new ScreenProjector(scene, camera, engine, () => ({ left: 0, top: 0, width: 2 * engine.getRenderWidth(), height: 2 * engine.getRenderHeight() }));
  const dc = doubled.pointOf(Vector3.Zero());
  check(near(dc.x, engine.getRenderWidth(), 1) && near(dc.y, engine.getRenderHeight(), 1), "масштаб рендер-буфера к CSS-размеру учтён");

  // Сундук: точка вылета над крышкой, копия (изменение не двигает сундук).
  const gs = new GameState();
  const chest = new Chest(scene, new Vector3(2, 0, 3), { id: "present-1", bookIds: [earthBookId], pageIds: [] }, gs);
  const open = chest.openingPoint;
  check(near(open.x, 2) && near(open.z, 3) && open.y > 0.84 && open.y < 1.2, "точка вылета — над крышкой сундука");
  open.y = 99;
  check(chest.position.y === 0 && chest.openingPoint.y < 2, "openingPoint — копия, сундук не сдвигается");
  check(!chest.isOpened, "до осмотра сундук закрыт (презентация ждёт первого открытия)");
  const firstTime = !chest.isOpened;
  const items = buildLootItems(chest.open(), gs);
  check(firstTime && items.length === 1 && items[0].kind === "book" && chest.isOpened, "первое открытие даёт предметы для показа");
  check(buildLootItems(chest.open(), gs).length === 1 && chest.isOpened, "повторный осмотр: сундук уже открыт — показ не запускается (по isOpened)");
  scene.dispose();
}

check(ALL_BOOKS.length >= 1, "в данных есть книги для показа");

if (failures > 0) {
  console.error(`\n${failures} из ${checks} проверок не прошли`);
  process.exit(1);
}
console.log(`OK: презентация находок прошла ${checks} проверок`);
