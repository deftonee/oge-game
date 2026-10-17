import { GameState } from "../src/core/GameState";
import { ALL_SCHOOLS, ALL_SPELLS, getSpellById, getSpellsBySchool } from "../src/data/spells";
import { ALL_BOOKS, bookIdOfSchool, booksRequiredFor, getBookBySchool, getPageBySpell, pageIdOfSpell } from "../src/data/books";
import { hasLootToFind, pickChestLoot, resolveChestLoot } from "../src/learning/chestLoot";
import { generateWorld } from "../src/world/WorldGenerator";
import type { ChestSpec, SectionSpec } from "../src/world/WorldGenerator";
import { INTRO_RULES } from "../src/world/generation/WorldGenConfig";

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

/** generateWorld логирует каждую секцию — в симуляции на сотнях сидов это шум. */
function quiet<T>(fn: () => T): T {
  const original = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = original;
  }
}

// ---------------------------------------------------------------------------
// 1. Книги и страницы выводятся из данных заклинаний.
// ---------------------------------------------------------------------------
{
  const schoolsWithSpells = ALL_SCHOOLS.filter((s) => getSpellsBySchool(s.id).length > 0);
  check(ALL_BOOKS.length === schoolsWithSpells.length, "книга есть ровно у каждой школы с заклинаниями");
  for (const school of ALL_SCHOOLS) {
    const book = getBookBySchool(school.id);
    const hasSpells = getSpellsBySchool(school.id).length > 0;
    check(hasSpells === !!book, `школа «${school.id}»: книга есть тогда и только тогда, когда есть заклинания`);
  }

  const pageIds = ALL_BOOKS.flatMap((b) => b.pages.map((p) => p.id));
  check(new Set(pageIds).size === pageIds.length, "id страниц уникальны");
  check(pageIds.length === ALL_SPELLS.length, "страниц ровно столько же, сколько заклинаний");
  check(new Set(ALL_BOOKS.map((b) => b.id)).size === ALL_BOOKS.length, "id книг уникальны");

  for (const spell of ALL_SPELLS) {
    const page = getPageBySpell(spell.id);
    check(!!page && page.id === pageIdOfSpell(spell.id), `у «${spell.id}» есть страница page-${spell.id}`);
    check(page?.bookId === bookIdOfSchool(spell.school), `страница «${spell.id}» лежит в книге основной школы`);
    check(booksRequiredFor(spell).length === spell.schools.length, `«${spell.id}»: нужна книга каждой школы заклинания`);
  }
  check(booksRequiredFor(getSpellById("machine_heart")).length === 2, "мост machine_heart требует две книги");
}

// ---------------------------------------------------------------------------
// 2. canLearn: нужны книга школы + страница + пререквизиты.
// ---------------------------------------------------------------------------
{
  const velocity = getSpellById("velocity");
  const acceleration = getSpellById("acceleration");
  const earthBook = bookIdOfSchool("earth");

  const gs = new GameState();
  check(gs.isUnlockable(velocity), "velocity доступен по дереву на старте");
  check(!gs.canLearn(velocity), "без материалов изучить нельзя");

  gs.collectBook(earthBook);
  check(!gs.canLearn(velocity), "одной книги мало — нужна страница");
  check(!gs.hasSpellPage(velocity) && gs.missingBooks(velocity).length === 0, "книга есть, страницы нет");

  gs.collectBookPage(pageIdOfSpell("velocity"));
  check(gs.canLearn(velocity), "книга + страница → можно изучить");

  const pageOnly = new GameState();
  pageOnly.collectBookPage(pageIdOfSpell("velocity"));
  check(!pageOnly.canLearn(velocity), "одной страницы без книги школы мало");
  check(pageOnly.missingBooks(velocity).map((b) => b.id).join() === earthBook, "missingBooks называет книгу Школы земли");

  // Материалы не отменяют пререквизиты.
  gs.collectBookPage(pageIdOfSpell("acceleration"));
  check(gs.hasMaterials(acceleration), "для acceleration материалы собраны");
  check(!gs.canLearn(acceleration), "acceleration нельзя без изученной velocity, даже со страницей");
  gs.learn("velocity");
  check(gs.canLearn(acceleration), "после velocity acceleration можно изучить");
  check(!gs.canLearn(velocity), "изученное заклинание повторно изучать нельзя");

  // Мост: нужны книги обеих школ.
  const bridge = getSpellById("machine_heart");
  const gb = new GameState();
  gb.learn("spark");
  gb.learn("flame");
  gb.collectBook(bookIdOfSchool("fire"));
  gb.collectBookPage(pageIdOfSpell("machine_heart"));
  check(!gb.canLearn(bridge), "мост: книги только одной школы — мало");
  gb.collectBook(bookIdOfSchool("earth"));
  check(gb.canLearn(bridge), "мост: книги обеих школ + страница + пререквизиты → можно");
}

// ---------------------------------------------------------------------------
// 3. recordChestLoot: запоминает содержимое и переносит находки игроку.
// ---------------------------------------------------------------------------
{
  const gs = new GameState();
  check(!gs.isChestOpen("c1") && gs.getChestLoot("c1") === undefined, "сундук поначалу закрыт, лута нет");

  gs.recordChestLoot("c1", { bookIds: [bookIdOfSchool("earth")], pageIds: [pageIdOfSpell("velocity")] });
  check(gs.isChestOpen("c1"), "после записи сундук открыт");
  check(gs.hasBook(bookIdOfSchool("earth")) && gs.hasBookPage(pageIdOfSpell("velocity")), "находки перенесены в коллекцию");

  const loot = gs.getChestLoot("c1")!;
  loot.bookIds.length = 0; // мутация копии не должна портить состояние
  check(gs.getChestLoot("c1")!.bookIds.length === 1, "getChestLoot возвращает копию");

  gs.recordChestLoot("c1", { bookIds: [bookIdOfSchool("earth")], pageIds: [pageIdOfSpell("velocity")] });
  check(gs.getCollectedBookIds().length === 1 && gs.getCollectedBookPageIds().length === 1, "повторная запись идемпотентна");
}

// ---------------------------------------------------------------------------
// 4. pickChestLoot: порядок, отсутствие дублей, книга раньше страницы.
// ---------------------------------------------------------------------------
{
  const gs = new GameState();
  check(hasLootToFind(gs), "на старте есть что находить");

  const first = pickChestLoot(gs, 2);
  check(first.bookIds.length === 1 && first.pageIds.length === 1, "первый сундук: книга и страница");
  check(first.bookIds[0] === bookIdOfSchool("earth") && first.pageIds[0] === pageIdOfSpell("velocity"), "начинаем со Школы земли и простейшей темы");
  check(pickChestLoot(gs, 0).bookIds.length + pickChestLoot(gs, 0).pageIds.length === 0, "ноль слотов — пустой сундук");

  let opened = 0;
  let guard = 0;
  while (guard++ < 50) {
    const loot = pickChestLoot(gs, 2);
    const items = loot.bookIds.length + loot.pageIds.length;
    if (items === 0) break;
    opened++;
    check(items <= 2, `сундук ${opened}: не больше слотов (${items})`);

    for (const id of loot.bookIds) check(!gs.hasBook(id), `сундук ${opened}: книга ${id} уже была у игрока`);
    for (const id of loot.pageIds) {
      check(!gs.hasBookPage(id), `сундук ${opened}: страница ${id} уже была у игрока`);
      const spell = ALL_SPELLS.find((s) => pageIdOfSpell(s.id) === id)!;
      // Страница не выпадает раньше книги своей школы.
      for (const book of booksRequiredFor(spell)) {
        check(gs.hasBook(book.id) || loot.bookIds.includes(book.id), `сундук ${opened}: страница ${id} раньше книги ${book.id}`);
      }
      // И не выпадает, пока не найдены (или не изучены) пререквизиты.
      for (const pre of spell.prerequisites) {
        check(
          gs.isLearned(pre) || gs.hasBookPage(pageIdOfSpell(pre)) || loot.pageIds.includes(pageIdOfSpell(pre)),
          `сундук ${opened}: страница ${id} без страницы пререквизита ${pre}`
        );
      }
    }
    gs.recordChestLoot(`probe-${opened}`, loot);
  }
  check(guard < 50, "раздача конечна");
  check(ALL_BOOKS.every((b) => gs.hasBook(b.id)), "в итоге выдаются ВСЕ книги");
  check(ALL_SPELLS.every((s) => gs.hasSpellPage(s)), "в итоге выдаются ВСЕ страницы");
  check(!hasLootToFind(gs), "когда всё найдено, искать больше нечего");
  const expectedItems = ALL_BOOKS.length + ALL_SPELLS.length;
  check(opened === Math.ceil(expectedItems / 2), `предметов ${expectedItems} по 2 в сундук → ${Math.ceil(expectedItems / 2)} сундуков, было ${opened}`);

  // Уже изученное (например, стартовое) искать не нужно.
  const learnedState = new GameState();
  learnedState.learn("velocity");
  const loot = pickChestLoot(learnedState, 20);
  check(!loot.pageIds.includes(pageIdOfSpell("velocity")), "страница изученного заклинания не выдаётся");
}

// ---------------------------------------------------------------------------
// 5. Вводные сундуки: без них игрок упёрся бы в первые ворота.
// ---------------------------------------------------------------------------
{
  const gs = new GameState();
  const introChests = INTRO_RULES[0].chests;
  check(Array.isArray(introChests) && introChests.length === 1, "в первой секции есть вводный сундук");
  const chest = (introChests as ChestSpec[])[0];
  gs.recordChestLoot(chest.id, resolveChestLoot(chest, gs));

  const learnable = ALL_SPELLS.filter((s) => gs.canLearn(s));
  check(learnable.length >= 2, `после вводного сундука можно изучить хотя бы 2 темы (требование первых ворот), а можно ${learnable.length}`);

  const introSecond = (INTRO_RULES[1].chests as ChestSpec[])[0];
  const loot2 = resolveChestLoot(introSecond, gs);
  check(loot2.bookIds.includes(bookIdOfSchool("fire")), "второй вводный сундук даёт книгу второй ветки (Школа пламени)");
}

// ---------------------------------------------------------------------------
// 6. Симуляция прохождения: на каждом сиде игрок идёт по трассе, открывает
//    только сундуки на пути, учит всё, что можно, — и у каждых ворот обязан
//    иметь не меньше изученных тем, чем заявлено на барьере.
//    Боковые ниши НЕ собираем (они необязательны) — проверяем худший случай.
// ---------------------------------------------------------------------------
function learnEverythingPossible(gs: GameState): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const spell of ALL_SPELLS) {
      if (gs.canLearn(spell)) {
        gs.learn(spell.id);
        changed = true;
      }
    }
  }
}

function simulate(seed: number, branch: "a" | "b", withSpurs: boolean): { gatesChecked: number; minSlack: number } {
  const gs = new GameState();
  const world = quiet(() => generateWorld(gs, seed));

  // Развилка: выбираем одну из живых веток (тупиковая не ведёт дальше).
  const aliveByFork = new Map<number, SectionSpec[]>();
  for (const s of world.sections) {
    if (!s.forkBranch || s.isDeadEnd) continue;
    const list = aliveByFork.get(s.forkParentIndex ?? -1) ?? [];
    list.push(s);
    aliveByFork.set(s.forkParentIndex ?? -1, list);
  }
  const chosen = new Set<SectionSpec>();
  for (const list of aliveByFork.values()) chosen.add(list.find((s) => s.forkBranch === branch) ?? list[0]);

  let gatesChecked = 0;
  let minSlack = Infinity;
  const openChest = (c: ChestSpec): void => {
    const loot = resolveChestLoot(c, gs);
    if (c.dynamic) {
      for (const id of loot.bookIds) check(!gs.hasBook(id), `seed ${seed}: сундук ${c.id} выдал уже имеющуюся книгу ${id}`);
      for (const id of loot.pageIds) check(!gs.hasBookPage(id), `seed ${seed}: сундук ${c.id} выдал уже имеющуюся страницу ${id}`);
    }
    gs.recordChestLoot(c.id, loot);
  };

  for (const section of world.sections) {
    if (section.forkBranch && !chosen.has(section)) continue;
    for (const c of section.chests) openChest(c);
    if (withSpurs) for (const spur of section.sideSpurs) openChest(spur.chest);
    learnEverythingPossible(gs);

    const learned = ALL_SPELLS.filter((s) => gs.isLearned(s.id)).length;
    for (const gate of section.gates) {
      gatesChecked++;
      minSlack = Math.min(minSlack, learned - gate.requiredSpells);
      check(learned >= 1, `seed ${seed}: у ворот ${gate.id} нет ни одной изученной темы — тупик`);
      check(
        learned >= gate.requiredSpells,
        `seed ${seed} (ветка ${branch}${withSpurs ? ", с нишами" : ""}): у ворот ${gate.id} изучено ${learned}, нужно ${gate.requiredSpells}`
      );
    }
  }
  return { gatesChecked, minSlack };
}

{
  const SEEDS = 200;
  let gates = 0;
  let worstSlack = Infinity;
  for (let seed = 1; seed <= SEEDS; seed++) {
    for (const branch of ["a", "b"] as const) {
      for (const withSpurs of [false, true]) {
        const r = simulate(seed, branch, withSpurs);
        gates += r.gatesChecked;
        worstSlack = Math.min(worstSlack, r.minSlack);
      }
    }
  }
  check(gates > 0, "симуляция проверила хотя бы одни ворота");
  console.log(`Симуляция: ${SEEDS} сидов × 2 ветки × (без ниш / с нишами), ворот проверено: ${gates}, минимальный запас изученных тем: ${worstSlack}`);
}

if (failures === 0) {
  console.log(`Проверок: ${checks}, провалов: 0`);
  console.log("OK: книги, страницы, сундуки и прогрессия (без тупиков на воротах)");
} else {
  console.error(`Проверок: ${checks}, провалов: ${failures}`);
  console.error("FAILED: система книг и страниц нарушена");
  process.exit(1);
}
