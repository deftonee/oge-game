// Сохранения: снимок и восстановление GameState, разбор/проверка формата, хранилище, автосохранение
// (с поддельными таймерами и событиями страницы), подпись мира и продолжение игры в createWorld
// (тот же мир → прогресс и позиция на месте; изменился генератор → мир новый, общий прогресс остался).
import { NullEngine, Scene } from "@babylonjs/core";
import { GameState, MAX_MASTERY } from "../src/core/GameState";
import { createWorld } from "../src/core/worldSetup";
import { ALL_BOOKS } from "../src/data/books";
import { ALL_SPELLS, STARTER_SPELL_IDS } from "../src/data/spells";
import { AutoSave } from "../src/save/AutoSave";
import type { PageEvents, Timers } from "../src/save/AutoSave";
import { SAVE_VERSION, parseSave } from "../src/save/saveData";
import type { GameSave } from "../src/save/saveData";
import { SAVE_KEY, SaveStore } from "../src/save/SaveStore";
import type { SaveStorage } from "../src/save/SaveStore";
import { worldSignature } from "../src/save/worldSignature";
import { localToWorld } from "../src/world/geometry/SectionGeometry";
import { generateWorld } from "../src/world/WorldGenerator";

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

/** Генератор мира и сборка сцены пишут в console.log — на время тестов глушим. */
function quietly<T>(fn: () => T): T {
  const log = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
  }
}

interface MemoryStorage extends SaveStorage {
  data: Record<string, string>;
  writes: number;
  failWrites: boolean;
  failReads: boolean;
  failRemoves: boolean;
}

function memoryStorage(): MemoryStorage {
  const m: MemoryStorage = {
    data: {},
    writes: 0,
    failWrites: false,
    failReads: false,
    failRemoves: false,
    getItem(key) {
      if (m.failReads) throw new Error("read denied");
      return m.data[key] ?? null;
    },
    setItem(key, value) {
      if (m.failWrites) throw new Error("quota");
      m.writes++;
      m.data[key] = value;
    },
    removeItem(key) {
      if (m.failRemoves) throw new Error("remove denied");
      delete m.data[key];
    },
  };
  return m;
}

const spellsToLearn = ALL_SPELLS.filter((s) => !STARTER_SPELL_IDS.includes(s.id));
const SPELL_A = spellsToLearn[0].id;
const SPELL_B = spellsToLearn[1].id;
const BOOK = ALL_BOOKS[0];
const PAGE = BOOK.pages[0];

const notifier = (gs: GameState): { count: () => number; stop: () => void } => {
  let n = 0;
  const stop = gs.subscribe(() => void n++);
  return { count: () => n, stop };
};

// ---------------------------------------------------------------------------
// 1. GameState: уведомления об изменениях
// ---------------------------------------------------------------------------
{
  const gs = new GameState();
  const n = notifier(gs);
  check(n.count() === 0, "после создания уведомлений нет");

  gs.markWitchDefeated("w1");
  check(n.count() === 1, "новая побеждённая ведьма — уведомление");
  gs.markWitchDefeated("w1");
  check(n.count() === 1, "та же ведьма повторно — уведомления нет");

  gs.openGate("g1");
  gs.openGate("g1");
  gs.openChest("c1");
  gs.openChest("c1");
  check(n.count() === 3, "ворота и сундуки: только реальные изменения");

  gs.collectBook(BOOK.id);
  gs.collectBook(BOOK.id);
  gs.collectBookPage(PAGE.id);
  gs.collectBookPage(PAGE.id);
  check(n.count() === 5, "книга и страница: только реальные изменения");

  const before = n.count();
  gs.addMastery(SPELL_A);
  check(n.count() === before, "мастерство неизученного заклинания не меняется и не сообщается");
  gs.learn(SPELL_A);
  check(n.count() === before + 1, "изучение — уведомление");
  gs.learn(SPELL_A);
  check(n.count() === before + 1, "повторное изучение — без уведомления");
  gs.addMastery(SPELL_A);
  check(n.count() === before + 2, "рост мастерства — уведомление");
  for (let i = 0; i < MAX_MASTERY + 2; i++) gs.addMastery(SPELL_A);
  const atMax = n.count();
  gs.addMastery(SPELL_A);
  check(n.count() === atMax, "мастерство на максимуме больше не растёт и не сообщается");

  n.stop();
  gs.markWitchDefeated("w2");
  check(n.count() === atMax, "после отписки уведомлений нет");

  const gs2 = new GameState();
  const n2 = notifier(gs2);
  gs2.recordChestLoot("chest-1", { bookIds: [BOOK.id], pageIds: [PAGE.id] });
  check(n2.count() >= 1 && gs2.getChestLoot("chest-1") !== undefined, "содержимое сундука — часть прогресса и сообщается");
}

// ---------------------------------------------------------------------------
// 2. GameState: снимок и восстановление
// ---------------------------------------------------------------------------
{
  const fresh = new GameState().snapshot();
  check(fresh.learned.length === STARTER_SPELL_IDS.length && STARTER_SPELL_IDS.every((id) => fresh.learned.includes(id)), "у нового забега изучены только стартовые заклинания");
  check(Object.keys(fresh.mastery).length === 0 && fresh.defeatedWitchIds.length === 0 && fresh.bookIds.length === 0, "новый снимок пуст");

  const gs = new GameState();
  gs.learn(SPELL_A);
  gs.learn(SPELL_B);
  gs.addMastery(SPELL_A, 3);
  gs.markWitchDefeated("w1");
  gs.openGate("g1");
  gs.recordChestLoot("c1", { bookIds: [BOOK.id], pageIds: [PAGE.id] });
  const snap = gs.snapshot();
  check(JSON.stringify(JSON.parse(JSON.stringify(snap))) === JSON.stringify(snap), "снимок — чистые данные (проходит через JSON без потерь)");

  const copy = new GameState();
  copy.restore(JSON.parse(JSON.stringify(snap)));
  check(JSON.stringify(copy.snapshot()) === JSON.stringify(snap), "снимок → восстановление → снимок даёт то же самое");
  check(copy.isWitchDefeated("w1") && copy.isGateOpen("g1") && copy.isChestOpen("c1"), "мировой прогресс восстановлен");
  check(copy.hasBook(BOOK.id) && copy.hasBookPage(PAGE.id), "книги и страницы восстановлены");

  snap.defeatedWitchIds.push("tampered");
  snap.learned.length = 0;
  check(!gs.isWitchDefeated("tampered") && gs.snapshot().learned.length > 0, "снимок — копия, а не ссылка на внутреннее состояние");

  // Восстановление ЗАМЕНЯЕТ прогресс, а не дополняет.
  const dirty = new GameState();
  dirty.learn(SPELL_B);
  dirty.markWitchDefeated("old");
  dirty.collectBook(BOOK.id);
  dirty.restore(new GameState().snapshot());
  check(!dirty.isWitchDefeated("old") && !dirty.hasBook(BOOK.id) && !dirty.snapshot().learned.includes(SPELL_B), "restore заменяет прежний прогресс");

  // Снимок от другой версии игры: лишнее отбрасывается, а не ломает игру.
  const weird = new GameState();
  weird.restore({
    learned: ["no-such-spell", SPELL_A],
    mastery: { [SPELL_A]: 99, [SPELL_B]: 4, "no-such-spell": 2 },
    defeatedWitchIds: ["w9"],
    openedGateIds: [],
    openedChestIds: ["c9"],
    bookPageIds: ["no-such-page", PAGE.id],
    bookIds: ["no-such-book", BOOK.id],
    chestLoot: { c9: { bookIds: ["no-such-book", BOOK.id], pageIds: ["no-such-page"] } },
  });
  const ws = weird.snapshot();
  check(ws.learned.includes(SPELL_A) && !ws.learned.includes("no-such-spell"), "неизвестное заклинание отброшено");
  check(ws.mastery[SPELL_A] === MAX_MASTERY, "мастерство ограничено максимумом");
  check(ws.mastery[SPELL_B] === undefined, "мастерство неизученного заклинания не восстанавливается");
  check(STARTER_SPELL_IDS.every((id) => ws.learned.includes(id)), "стартовые заклинания изучены, даже если их нет в снимке");
  check(JSON.stringify(ws.bookIds) === JSON.stringify([BOOK.id]) && JSON.stringify(ws.bookPageIds) === JSON.stringify([PAGE.id]), "неизвестные книги и страницы отброшены");
  check(JSON.stringify(ws.chestLoot.c9) === JSON.stringify({ bookIds: [BOOK.id], pageIds: [] }), "в содержимом сундука тоже");

  const negative = new GameState();
  negative.restore({ ...new GameState().snapshot(), learned: [SPELL_A], mastery: { [SPELL_A]: -5 } });
  check((negative.snapshot().mastery[SPELL_A] ?? 0) === 0, "отрицательное мастерство → 0");

  // world: false — мир другой: id ведьм/ворот/сундуков не значат ничего, общий прогресс остаётся.
  const other = new GameState();
  other.restore(gs.snapshot(), { world: false });
  const os = other.snapshot();
  check(os.defeatedWitchIds.length === 0 && os.openedGateIds.length === 0 && os.openedChestIds.length === 0 && Object.keys(os.chestLoot).length === 0, "world:false — привязанное к миру отброшено");
  check(os.learned.includes(SPELL_A) && os.bookIds.includes(BOOK.id) && os.bookPageIds.includes(PAGE.id) && os.mastery[SPELL_A] === 3, "world:false — заклинания, книги, страницы, мастерство остались");

  const restored = new GameState();
  const rn = notifier(restored);
  restored.restore(gs.snapshot());
  check(rn.count() >= 1, "восстановление сообщает подписчикам");
}

// ---------------------------------------------------------------------------
// 3. Формат: parseSave
// ---------------------------------------------------------------------------
function validSave(): GameSave {
  return {
    version: SAVE_VERSION,
    savedAt: 1700000000000,
    world: { seed: 42, signature: "abc-123" },
    progress: (() => {
      const gs = new GameState();
      gs.learn(SPELL_A);
      gs.addMastery(SPELL_A, 2);
      gs.markWitchDefeated("w1");
      gs.recordChestLoot("c1", { bookIds: [BOOK.id], pageIds: [PAGE.id] });
      return gs.snapshot();
    })(),
    player: { x: 12.5, z: -340.25 },
  };
}

{
  const save = validSave();
  const parsed = parseSave(JSON.parse(JSON.stringify(save)));
  check(parsed !== null && JSON.stringify(parsed) === JSON.stringify(save), "корректное сохранение проходит через JSON и разбор без потерь");

  const raw = JSON.parse(JSON.stringify(save));
  const parsed2 = parseSave(raw);
  check(parsed2 !== null && parsed2.progress !== raw.progress && parsed2.progress.learned !== raw.progress.learned, "разбор возвращает копию, а не ссылки на сырые данные");

  const bad = (label: string, mutate: (r: Record<string, any>) => void): void => {
    const r = JSON.parse(JSON.stringify(save));
    mutate(r);
    check(parseSave(r) === null, `отклоняется: ${label}`);
  };
  for (const v of [null, undefined, 0, 1, "save", [], true]) check(parseSave(v) === null, `отклоняется: ${JSON.stringify(v)}`);
  check(parseSave({}) === null, "отклоняется: пустой объект");
  bad("версия 2", (r) => (r.version = 2));
  bad("версии нет", (r) => delete r.version);
  bad("savedAt — строка", (r) => (r.savedAt = "вчера"));
  bad("мира нет", (r) => delete r.world);
  bad("seed — строка", (r) => (r.world.seed = "42"));
  bad("seed — null (NaN после JSON)", (r) => (r.world.seed = null));
  bad("подпись пустая", (r) => (r.world.signature = ""));
  bad("подпись — число", (r) => (r.world.signature = 5));
  bad("подпись слишком длинная", (r) => (r.world.signature = "x".repeat(65)));
  bad("игрока нет", (r) => delete r.player);
  bad("координата игрока — null", (r) => (r.player.x = null));
  bad("координата игрока неправдоподобно велика", (r) => (r.player.z = 1e9));
  bad("прогресса нет", (r) => delete r.progress);
  bad("прогресс — массив", (r) => (r.progress = []));
  bad("список изученных — строка", (r) => (r.progress.learned = "abc"));
  bad("список ведьм — объект", (r) => (r.progress.defeatedWitchIds = {}));
  bad("мастерство — массив", (r) => (r.progress.mastery = [1, 2]));
  bad("содержимое сундуков — строка", (r) => (r.progress.chestLoot = "x"));

  // Снисходительность там, где данные просто «неполные» или с мусором внутри.
  const lenient = JSON.parse(JSON.stringify(save));
  delete lenient.progress.openedGateIds;
  delete lenient.progress.mastery;
  delete lenient.progress.chestLoot;
  lenient.progress.bookIds = [BOOK.id, 7, null, "", "x".repeat(121), {}, BOOK.id];
  lenient.progress.learned = [SPELL_A, 3];
  const l = parseSave(lenient);
  check(l !== null, "старое сохранение без части полей читается");
  check(l !== null && l.progress.openedGateIds.length === 0 && Object.keys(l.progress.mastery).length === 0 && Object.keys(l.progress.chestLoot).length === 0, "недостающие поля становятся пустыми");
  check(l !== null && JSON.stringify(l.progress.bookIds) === JSON.stringify([BOOK.id, BOOK.id]) && JSON.stringify(l.progress.learned) === JSON.stringify([SPELL_A]), "мусор внутри списков id отбрасывается");

  const partial = JSON.parse(JSON.stringify(save));
  partial.progress.mastery = { ok: 3, nan: null, str: "5", long: 1 };
  partial.progress.mastery["m".repeat(121)] = 2;
  partial.progress.chestLoot = { good: { bookIds: [BOOK.id], pageIds: [] }, bad1: "x", bad2: { bookIds: "no", pageIds: [] }, bad3: null };
  const p = parseSave(partial);
  check(p !== null && Object.keys(p.progress.mastery).sort().join() === "long,ok", "мастерство: нечисловые значения и длинные ключи отброшены");
  check(p !== null && Object.keys(p.progress.chestLoot).join() === "good", "содержимое сундуков: испорченные записи отброшены, хорошая осталась");

  // Потолок длины списков.
  const huge = JSON.parse(JSON.stringify(save));
  huge.progress.defeatedWitchIds = Array.from({ length: 6000 }, (_, i) => `w${i}`);
  check(parseSave(huge)!.progress.defeatedWitchIds.length === 5000, "список обрезается до потолка (защита от раздутых данных)");

  // Ключ «__proto__» — обычный ключ, глобальные прототипы не страдают.
  const evil = JSON.parse(`{"version":1,"savedAt":1,"world":{"seed":1,"signature":"s"},"player":{"x":0,"z":0},"progress":{"mastery":{"__proto__":3,"constructor":2},"chestLoot":{"__proto__":{"bookIds":[],"pageIds":[]}}}}`);
  const e = parseSave(evil);
  check(e !== null && Object.keys(e.progress.mastery).includes("__proto__") && ({} as Record<string, unknown>).polluted === undefined, "ключ __proto__ не ломает прототипы");
  const gsEvil = new GameState();
  let threw = false;
  try {
    gsEvil.restore(e!.progress);
  } catch {
    threw = true;
  }
  check(!threw, "restore переваривает такие ключи");
}

// ---------------------------------------------------------------------------
// 4. SaveStore
// ---------------------------------------------------------------------------
{
  const mem = memoryStorage();
  const store = new SaveStore(mem);
  check(store.available, "хранилище есть — сохранение доступно");
  check(store.load() === null, "сохранения нет → null");
  const save = validSave();
  check(store.write(save) === true, "запись удалась");
  check(mem.data[SAVE_KEY] !== undefined && SAVE_KEY.endsWith(`v${SAVE_VERSION}`), "ключ содержит версию формата");
  check(JSON.stringify(store.load()) === JSON.stringify(save), "записанное читается без потерь");
  store.clear();
  check(store.load() === null && mem.data[SAVE_KEY] === undefined, "clear стирает сохранение");

  mem.data[SAVE_KEY] = "{не json";
  check(store.load() === null, "битый JSON → null, без исключения");
  mem.data[SAVE_KEY] = JSON.stringify({ ...save, version: 99 });
  check(store.load() === null, "сохранение другой версии → null");
  mem.data[SAVE_KEY] = JSON.stringify({ ...save, player: null });
  check(store.load() === null, "повреждённое сохранение → null");

  mem.failWrites = true;
  check(store.write(save) === false && !store.available, "квота/запрет записи: write → false, available → false");
  mem.failWrites = false;
  check(store.write(save) === true && store.available, "после успешной записи available снова true");

  mem.failReads = true;
  check(store.load() === null, "запрет чтения → null, без исключения");
  mem.failReads = false;

  mem.failRemoves = true;
  let threw = false;
  try {
    store.clear();
  } catch {
    threw = true;
  }
  check(!threw, "ошибка при стирании не пробрасывается");

  const none = new SaveStore(null);
  check(!none.available && none.load() === null && none.write(save) === false, "без localStorage: недоступно, load → null, write → false");
  none.clear();
}

// ---------------------------------------------------------------------------
// 5. AutoSave (поддельные таймеры и события страницы)
// ---------------------------------------------------------------------------
class FakeTimers implements Timers {
  public now = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, { at: number; fn: () => void; every?: number }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.now + ms, fn });
    return id;
  }
  clearTimeout(id: unknown): void {
    this.tasks.delete(id as number);
  }
  setInterval(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.now + ms, fn, every: ms });
    return id;
  }
  clearInterval(id: unknown): void {
    this.tasks.delete(id as number);
  }
  get pending(): number {
    return this.tasks.size;
  }
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let nextId = -1;
      let nextAt = Infinity;
      for (const [id, t] of this.tasks) if (t.at <= end && t.at < nextAt) [nextId, nextAt] = [id, t.at];
      if (nextId < 0) break;
      const t = this.tasks.get(nextId)!;
      this.now = t.at;
      if (t.every !== undefined) t.at += t.every;
      else this.tasks.delete(nextId);
      t.fn();
    }
    this.now = end;
  }
}

class FakeTarget {
  private readonly handlers = new Map<string, Set<() => void>>();
  public hidden = false;
  addEventListener(type: string, fn: () => void): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.handlers.get(type)?.delete(fn);
  }
  emit(type: string): void {
    for (const fn of [...(this.handlers.get(type) ?? [])]) fn();
  }
  count(): number {
    let n = 0;
    for (const set of this.handlers.values()) n += set.size;
    return n;
  }
}

function autosaveRig(over: { getPlayer?: () => { x: number; z: number } | null } = {}) {
  const mem = memoryStorage();
  const store = new SaveStore(mem);
  const gs = new GameState();
  const timers = new FakeTimers();
  const doc = new FakeTarget();
  const win = new FakeTarget();
  let clock = 1000;
  const pos = { x: 1, z: 2 };
  const auto = new AutoSave({
    store,
    gameState: gs,
    world: { seed: 7, signature: "sig-7" },
    initialPlayer: { x: 0, z: 0 },
    getPlayer: over.getPlayer ?? (() => ({ x: pos.x, z: pos.z })),
    now: () => clock,
    timers,
    events: { document: doc, window: win } as unknown as PageEvents,
  });
  return { mem, store, gs, timers, doc, win, auto, pos, tick: (n: number) => void (clock += n) };
}

{
  const r = autosaveRig();
  check(r.mem.writes === 1, "первая запись — сразу при создании (перезагрузка вернёт тот же мир)");
  const first = r.store.load()!;
  check(first.world.seed === 7 && first.world.signature === "sig-7" && first.player.x === 1 && first.player.z === 2 && first.savedAt === 1000, "в записи мир, позиция и время");

  r.auto.flush();
  r.tick(5000);
  r.auto.flush();
  check(r.mem.writes === 1, "ничего не изменилось — повторно не пишем (время не считается изменением)");

  // Серия изменений пишется одной записью после паузы.
  r.gs.markWitchDefeated("w1");
  r.gs.openChest("c1");
  r.gs.learn(SPELL_A);
  r.gs.addMastery(SPELL_A);
  check(r.mem.writes === 1, "изменение прогресса само по себе мгновенной записи не вызывает");
  r.timers.advance(1499);
  check(r.mem.writes === 1, "до конца паузы (1,5 с) записи нет");
  r.timers.advance(1);
  check(r.mem.writes === 2, "серия изменений записана одной записью");
  const second = r.store.load()!;
  check(second.progress.defeatedWitchIds.includes("w1") && second.progress.learned.includes(SPELL_A) && second.progress.mastery[SPELL_A] === 1, "в записи свежий прогресс");

  // Позиция: округляется, пишется по таймеру.
  r.pos.x = 10.123456;
  r.pos.z = -5.987654;
  r.timers.advance(20_000);
  check(r.mem.writes === 3, "по таймеру записывается новая позиция");
  const third = r.store.load()!;
  check(third.player.x === 10.12 && third.player.z === -5.99, "позиция округлена до сотых");
  r.timers.advance(60_000);
  check(r.mem.writes === 3, "игрок стоит на месте — таймер ничего не пишет");

  // Вкладка: скрытие и закрытие.
  r.pos.x = 50;
  r.doc.hidden = false;
  r.doc.emit("visibilitychange");
  check(r.mem.writes === 3, "вкладка снова видна — запись не нужна");
  r.doc.hidden = true;
  r.doc.emit("visibilitychange");
  check(r.mem.writes === 4 && r.store.load()!.player.x === 50, "вкладку скрыли — записали");
  r.pos.x = 60;
  r.win.emit("pagehide");
  check(r.mem.writes === 5 && r.store.load()!.player.x === 60, "страницу закрывают — записали");

  // flush() отменяет ожидающую отложенную запись (не пишем дважды).
  r.gs.openGate("g1");
  check(r.timers.pending >= 2, "отложенная запись ждёт своего часа");
  r.auto.flush();
  const afterFlush = r.mem.writes;
  r.timers.advance(5000);
  check(r.mem.writes === afterFlush, "после ручной записи отложенная ничего не добавляет");

  // dispose: последняя запись и отписка.
  r.gs.openGate("g2");
  r.auto.dispose();
  check(r.store.load()!.progress.openedGateIds.includes("g2"), "dispose записывает последние изменения");
  check(r.doc.count() === 0 && r.win.count() === 0 && r.timers.pending === 0, "dispose снимает все слушатели и таймеры");
  const w = r.mem.writes;
  r.gs.openGate("g3");
  r.timers.advance(60_000);
  r.doc.hidden = true;
  r.doc.emit("visibilitychange");
  check(r.mem.writes === w && r.auto.flush() === false, "после dispose ничего не пишется");
}

{
  // В бою позицию не обновляем: остаётся последняя «спокойная».
  let inCombat = false;
  const where = { x: 3, z: 4 };
  const r = autosaveRig({ getPlayer: () => (inCombat ? null : { x: where.x, z: where.z }) });
  check(r.store.load()!.player.x === 3, "до боя пишется настоящая позиция");
  inCombat = true;
  where.x = 99;
  r.gs.markWitchDefeated("w1");
  r.timers.advance(2000);
  const s = r.store.load()!;
  check(s.player.x === 3 && s.progress.defeatedWitchIds.includes("w1"), "в бою прогресс пишется, а позиция остаётся прежней");
  inCombat = false;
  r.auto.flush();
  check(r.store.load()!.player.x === 99, "после боя позиция снова обновляется");

  // Хранилище отказало — следующая попытка повторяет запись.
  r.mem.failWrites = true;
  r.gs.openChest("c-fail");
  check(r.auto.flush() === false && !r.store.available, "отказ хранилища: flush → false, available → false");
  r.mem.failWrites = false;
  check(r.auto.flush() === true && r.store.load()!.progress.openedChestIds.includes("c-fail"), "хранилище ожило — запись повторена");
}

{
  // «Новая игра»: сохранение стёрто и больше не воскресает.
  const r = autosaveRig();
  r.gs.markWitchDefeated("w1");
  r.auto.discard();
  check(r.store.load() === null, "discard стирает сохранение");
  r.gs.openGate("g1");
  r.timers.advance(60_000);
  r.doc.hidden = true;
  r.doc.emit("visibilitychange");
  r.win.emit("pagehide");
  check(r.store.load() === null && r.mem.data[SAVE_KEY] === undefined, "после discard закрытие страницы сохранение не воскрешает");
  check(r.auto.flush() === false, "после discard flush ничего не делает");
  check(r.doc.count() === 0 && r.win.count() === 0 && r.timers.pending === 0, "discard снимает слушатели и таймеры");
  r.auto.dispose(); // повторное завершение безопасно
  check(r.store.load() === null, "dispose после discard тоже не воскрешает сохранение");
}

// ---------------------------------------------------------------------------
// 6. Подпись мира
// ---------------------------------------------------------------------------
{
  const a = { sections: [1, 2, { x: 1.5 }], seed: 1 };
  check(worldSignature(a) === worldSignature(JSON.parse(JSON.stringify(a))), "подпись одинакова для одинаковых данных");
  check(worldSignature(a) !== worldSignature({ ...a, sections: [1, 2, { x: 1.6 }] }), "малейшее изменение меняет подпись");
  check(worldSignature(a) !== worldSignature({ ...a, sections: [1, 2, { x: 1.5 }, 0] }), "добавленный элемент меняет подпись");
  check(/^[0-9a-z]+-[0-9a-z]+$/.test(worldSignature(a)) && worldSignature(a).length <= 64, "подпись — короткая строка (влезает в формат сохранения)");

  const w1 = quietly(() => generateWorld(new GameState(), 1));
  const w1b = quietly(() => generateWorld(new GameState(), 1));
  const w2 = quietly(() => generateWorld(new GameState(), 2));
  check(worldSignature(w1) === worldSignature(w1b), "один seed → один и тот же мир → одна подпись");
  check(worldSignature(w1) !== worldSignature(w2), "другой seed → другая подпись");
}

// ---------------------------------------------------------------------------
// 7. Продолжение игры: createWorld
// ---------------------------------------------------------------------------
{
  const engine = new NullEngine();
  const newScene = (): Scene => new Scene(engine);

  // Новая игра: seed случаен (Date.now), поэтому проверяем только то, что от него не зависит.
  const gsNew = new GameState();
  const fresh = quietly(() => createWorld(newScene(), gsNew));
  check(!fresh.resumed, "без сохранения: новая игра");
  check(Number.isFinite(fresh.world.seed) && fresh.world.signature.length > 0, "новый мир описан seed и подписью");
  const freshSpec = quietly(() => generateWorld(new GameState(), fresh.world.seed));
  check(worldSignature(freshSpec) === fresh.world.signature, "подпись созданного мира = подпись мира с тем же seed");
  check(fresh.spawnPoint.x === freshSpec.spawnPoint.x && fresh.spawnPoint.z === freshSpec.spawnPoint.z, "новая игра начинается в стартовой точке");

  // Дальше — фиксированный seed, в мире которого есть развилка: тест не зависит от случая.
  let seed = 0;
  for (let candidate = 1; candidate <= 300 && seed === 0; candidate++) {
    const w = quietly(() => generateWorld(new GameState(), candidate));
    if (w.sections.some((sec) => sec.forkBranch && sec.forkGateId)) seed = candidate;
  }
  check(seed !== 0, "среди seed 1…300 есть мир с развилкой (нужен для проверки ветки)");
  const spec = quietly(() => generateWorld(new GameState(), seed || 1));
  const world = { seed: seed || 1, signature: worldSignature(spec) };
  const plain = spec.sections.find((sec) => !sec.forkBranch && sec.index >= 4)!;
  const branch = spec.sections.find((sec) => sec.forkBranch && sec.forkGateId)!;
  // Середина осевой линии секции: точка на стыке относится то к одной секции, то к другой.
  const middleOf = (sec: typeof plain): { x: number; z: number } => localToWorld(sec, 0, sec.length / 2);

  const progress = (() => {
    const gs = new GameState();
    gs.learn(SPELL_A);
    gs.addMastery(SPELL_A, 2);
    gs.markWitchDefeated("w-test");
    gs.openGate("g-test");
    gs.recordChestLoot("c-test", { bookIds: [BOOK.id], pageIds: [PAGE.id] });
    return gs.snapshot();
  })();
  const saveAt = (pos: { x: number; z: number }, snapshot = progress, w = world): GameSave => ({
    version: SAVE_VERSION,
    savedAt: 1,
    world: w,
    progress: snapshot,
    player: { x: pos.x, z: pos.z },
  });

  // Тот же мир: прогресс и позиция на месте.
  const far = middleOf(plain);
  const gs2 = new GameState();
  const resumed = quietly(() => createWorld(newScene(), gs2, saveAt(far)));
  check(resumed.resumed, "та же подпись → игра продолжена");
  check(resumed.world.seed === world.seed && resumed.world.signature === world.signature, "продолжение — тот же мир (seed и подпись)");
  check(resumed.spawnPoint.x === far.x && resumed.spawnPoint.z === far.z, "игрок появляется там, где остановился");
  check(resumed.spawnPoint.y === spec.spawnPoint.y, "высота — как у стартовой точки");
  check(JSON.stringify(gs2.snapshot()) === JSON.stringify(progress), "прогресс восстановлен целиком");
  quietly(() => resumed.streamer.update(far.x, far.z));
  check(resumed.streamer.sectionAt(far.x, far.z) === plain.index, "стример с первого кадра знает секцию игрока (перенос через весь мир)");
  check(resumed.streamer.isBuilt(plain.index), "секция вокруг игрока достроена сразу");
  check(!resumed.streamer.isBuilt(0), "начальные секции (где игрока нет) не строятся");

  // Сохранились внутри ветки развилки: ворота в прогрессе открыты, поэтому ветка «занята» сразу.
  const inBranch = middleOf(branch);
  const gsBranch = new GameState();
  const withGate: typeof progress = { ...progress, openedGateIds: [...progress.openedGateIds, branch.forkGateId!] };
  const branchSetup = quietly(() => createWorld(newScene(), gsBranch, saveAt(inBranch, withGate)));
  check(branchSetup.resumed && gsBranch.isGateOpen(branch.forkGateId!), "ворота развилки открыты уже к моменту создания мира");
  quietly(() => branchSetup.streamer.update(inBranch.x, inBranch.z));
  check(branchSetup.streamer.sectionAt(inBranch.x, inBranch.z) === branch.index, "игрок внутри ветки развилки определяется в ветке");
  check(branchSetup.streamer.isBuilt(branch.index), "секция ветки построена");

  // Мир уже другой: подпись не сошлась (поменяли генератор).
  const gs3 = new GameState();
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => void warnings.push(a.join(" "));
  const stale = quietly(() => createWorld(newScene(), gs3, saveAt(far, progress, { seed: world.seed, signature: "устарела" })));
  console.warn = warn;
  check(!stale.resumed, "подпись не сошлась → игра не продолжается в старом мире");
  check(warnings.length === 1 && warnings[0].includes("[save]"), "об этом предупреждение в консоли (один раз)");
  check(stale.world.signature !== "устарела" && stale.world.seed !== world.seed, "создан новый мир с новым seed");
  check(!(stale.spawnPoint.x === far.x && stale.spawnPoint.z === far.z), "позиция из старого мира не применяется");
  const ss = gs3.snapshot();
  check(ss.learned.includes(SPELL_A) && ss.mastery[SPELL_A] === 2 && ss.bookIds.includes(BOOK.id) && ss.bookPageIds.includes(PAGE.id), "в новом мире остались заклинания, мастерство, книги и страницы");
  check(ss.defeatedWitchIds.length === 0 && ss.openedGateIds.length === 0 && ss.openedChestIds.length === 0 && Object.keys(ss.chestLoot).length === 0, "привязанное к старому миру (ведьмы, ворота, сундуки) отброшено");

  engine.dispose();
}

if (failures > 0) {
  console.error(`\nFAILED: ${failures} из ${checks}`);
  process.exit(1);
}
console.log(`\n${checks}/${checks} проверок пройдено`);
console.log("OK: сохранения — снимок, формат, хранилище, автосохранение, подпись мира, продолжение игры");
