import { GameState } from "../src/core/GameState";
import { SectionContentBuilder } from "../src/world/SectionContent";
import { generateWorld, SectionSpec } from "../src/world/WorldGenerator";
import { ALL_BOOKS } from "../src/data/books";

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

/** Тот же PRNG, что и в генераторе мира (mulberry32) — детерминированный. */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Минимальный SectionSpec, достаточный для контентного наполнения. */
function makeSpec(index: number, tier = 2, length = 40, width = 24): SectionSpec {
  return {
    index,
    tier,
    color: "#ffffff",
    borderStyle: "bushes",
    length,
    width,
    start: { x: 0, z: 0 },
    end: { x: 0, z: length },
    yaw: 0,
    curvature: 0,
    gates: [],
    partitionDepth: 0,
    prevWidth: 0,
    prevEnd: { x: 0, z: 0 },
    prevWidth2: 0,
    prevEnd2: { x: 0, z: 0 },
    witches: [],
    bonfires: [],
    practiceTargets: [],
    chests: [],
    sideSpurs: [],
    grass: [],
    bushes: [],
    borderLeft: [],
    borderRight: [],
  };
}

function makeBuilder(gameState: GameState, seed = 1): SectionContentBuilder {
  const rng = mulberry32(seed);
  let witchCounter = 0;
  let chestCounter = 0;
  return new SectionContentBuilder(
    rng,
    gameState,
    () => `witch-${witchCounter++}`,
    () => `chest-${chestCounter++}`
  );
}

// ---------------------------------------------------------------------------
// 1. Точное правило: «указать что в секции точно должно быть».
// ---------------------------------------------------------------------------
{
  const gs = new GameState();
  const builder = makeBuilder(gs);
  const spec = makeSpec(5);

  const exactChest = { id: "chest-scripted", x: 3, z: 8, bookIds: ["mechanics_basics"], pageIds: ["mechanics_speed"] };
  builder.apply(spec, {
    bonfires: { exact: 2 },
    witches: { spellIds: ["spell_a", "spell_b", "spell_c"] },
    practiceTargets: { exact: 1 },
    chests: [exactChest],
  });

  check(spec.bonfires.length === 2, `точное правило: костров ${spec.bonfires.length}, ожидалось 2`);
  check(spec.witches.length === 3, `точное правило: ведьм ${spec.witches.length}, ожидалось 3`);
  check(
    spec.witches.every((w, i) => w.spellId === ["spell_a", "spell_b", "spell_c"][i]),
    "точное правило: ведьмы получили ровно указанные заклинания"
  );
  check(spec.practiceTargets.length === 1, `точное правило: целей ${spec.practiceTargets.length}, ожидалось 1`);
  check(spec.chests.length === 1, `точное правило: сундуков ${spec.chests.length}, ожидалось 1`);
  check(spec.chests[0]?.id === "chest-scripted", "точное правило: сундук с указанным id");
  check(
    spec.chests[0]?.bookIds[0] === "mechanics_basics" && spec.chests[0]?.pageIds[0] === "mechanics_speed",
    "точное правило: содержимое сундука как указано"
  );
}

// ---------------------------------------------------------------------------
// 2. Частичное правило: недостающее добирается процедурными умолчаниями.
// ---------------------------------------------------------------------------
{
  const gs = new GameState();
  const builder = makeBuilder(gs);
  const spec = makeSpec(6);

  builder.apply(spec, { bonfires: { exact: 2 } });

  check(spec.bonfires.length === 2, "частичное правило: 2 костра");
  check(spec.witches.length >= 1, `частичное правило: ведьм не должно быть 0 (умолчания из состояния) — ${spec.witches.length}`);
  check(spec.practiceTargets.length >= 2, `частичное правило: цели из умолчаний — ${spec.practiceTargets.length}`);
  check(spec.chests.length >= 1, `частичное правило: сундук из не собранных страниц — ${spec.chests.length}`);
  for (const e of spec.witches) check(e.z > 0 && e.z < spec.length && Math.abs(e.x) <= spec.width / 2 - 1, "частичное правило: ведьма в границах");
}

// ---------------------------------------------------------------------------
// 3. Процедурное правило из состояния игры: сундук содержит не собранное.
// ---------------------------------------------------------------------------
{
  const gs = new GameState();
  const uncollected = ALL_BOOKS.flatMap((b) => b.pages.map((p) => p.id)).filter((id) => !gs.hasBookPage(id));
  check(uncollected.length > 0, "в свежем состоянии есть что собирать");

  const builder = makeBuilder(gs);
  const spec = makeSpec(7);
  builder.apply(spec, SectionContentBuilder.defaultRule(gs, { tier: 2, isFirst: false }));

  check(spec.chests.length >= 1, `свежее состояние: сундук поставлен — ${spec.chests.length}`);
  const chestPageIds = spec.chests.flatMap((c) => c.pageIds);
  check(
    uncollected.every((id) => chestPageIds.includes(id)),
    `свежее состояние: сундук содержит ВСЕ не собранные страницы (${chestPageIds.join(",")})`
  );

  // Собрали всё — сундуков больше быть не должно.
  for (const id of uncollected) gs.collectBookPage(id);
  const spec2 = makeSpec(7);
  builder.apply(spec2, SectionContentBuilder.defaultRule(gs, { tier: 2, isFirst: false }));
  check(spec2.chests.length === 0, `после сбора всего лора сундуков нет — ${spec2.chests.length}`);
}

// ---------------------------------------------------------------------------
// 4. Первая секция: мягкий онбординг — без ведьм, костёр есть.
// ---------------------------------------------------------------------------
{
  const gs = new GameState();
  const builder = makeBuilder(gs);
  const spec = makeSpec(0, 1, 14, 8); // первая секция: узкая
  builder.apply(spec, SectionContentBuilder.defaultRule(gs, { tier: 1, isFirst: true }));

  check(spec.witches.length === 0, "первая секция: ведьм нет");
  check(spec.bonfires.length === 1, "первая секция: костёр есть");
  check(spec.chests.length === 0, "первая секция: сундуков нет (онбординг)");
}

// ---------------------------------------------------------------------------
// 5. Детерминизм: один seed — один и тот же мир.
// ---------------------------------------------------------------------------
{
  const a = generateWorld(new GameState(), 99);
  const b = generateWorld(new GameState(), 99);
  check(JSON.stringify(a.sections) === JSON.stringify(b.sections), "одинаковый seed → одинаковый мир");
}

// ---------------------------------------------------------------------------
// 6. Генерация целиком: id сундуков уникальны В ПРЕДЕЛАХ мира (ветки развилки
// делят index — глобальный счётчик билдера обязан это переживать; счётчик
// пересоздаётся на каждый generateWorld, поэтому межмировой уникальности нет
// и не требуется — ровно как у id ведьм).
// ---------------------------------------------------------------------------
{
  let worldsChecked = 0;
  let chestTotal = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const w = generateWorld(new GameState(), seed);
    const chestIds = w.sections.flatMap((s) => s.chests.map((c) => c.id));
    chestTotal += chestIds.length;
    check(
      new Set(chestIds).size === chestIds.length,
      `seed ${seed}: дубли id сундуков в мире`
    );
    worldsChecked++;
  }
  check(worldsChecked === 60 && chestTotal > 0, `проверено ${worldsChecked} миров, сундуков всего ${chestTotal}`);
  // В сундуках есть содержимое (книги/страницы существуют).
  const w = generateWorld(new GameState(), 1);
  const anyChest = w.sections.find((s) => s.chests.length > 0);
  check(!!anyChest, "в мире встречаются сундуки");
  if (anyChest) check(anyChest.chests.every((c) => c.bookIds.length + c.pageIds.length > 0), "сундуки всегда с содержимым");
}

console.log(`Проверок: ${checks}, провалов: ${failures}`);
if (failures > 0) {
  console.error("FAILED: конструктор секций");
  process.exit(1);
}
console.log("OK: конструктор секций — точные правила, процедура из состояния, детерминизм");