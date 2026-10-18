import { ALL_SPELLS } from "../data/spells";
import { GameState, MAX_MASTERY } from "../core/GameState";
import { CORRIDOR_CHEST_SLOTS, SPUR_CHEST_SLOTS, hasLootToFind } from "../learning/chestLoot";
import type { BorderStyle, ChestSpec, ScatterSeed, SectionSpec } from "./spec/SectionSpec";
import { pick, randInt, randRange, type RandomFn } from "./math/Rng";

/**
 * «Конструктор секций» — декларативное правило контента секции и его
 * процедурное наполнение.
 *
 * Две точки входа:
 *
 * 1. Точное правило (`SectionContentRule`): вызвавший указывает, ЧТО должно
 *    быть в секции — число костров, ведьм (вплоть до конкретных заклинаний),
 *    сундуков вместе с содержимым (bookIds/pageIds). Пригодно для рукописных
 *    секций и сюжетных сцен: `builder.apply(spec, { bonfires: { exact: 2 },
 *    witches: { spellIds: [...] }, chests: [ { id, x, z, bookIds, pageIds } ] })`.
 *
 * 2. Процедурное правило из состояния игры: `defaultRule(gameState, ctx)`
 *    отвечает на вопрос «что игроку нужно в следующей секции?» — и выводит
 *    правило, которое apply() воплощает в координаты:
 *    - ведьмы получают темы, где у игрока НИЗКОЕ мастерство (практика слабых
 *      мест); когда все доступные темы доведены до максимума — секция
 *      становится спокойнее (одна ведьма);
 *    - сундук с книгами/страницами появляется, только пока есть что находить
 *      (hasLootToFind); что именно в нём лежит, решается при ОТКРЫТИИ из
 *      состояния игрока (learning/chestLoot.ts) — после сбора всего лора
 *      новые сундуки в мире не ставятся;
 *    - костёр — центр обучения: есть пока есть что учить.
 *
 * `apply()` сам смешивает частичное правило с умолчаниями
 * (`{ ...defaultRule(...), ...rule }`), поэтому правило можно задавать
 * частично: `{ bonfires: { exact: 2 } }` оставит остальной контент
 * процедурным.
 *
 * Все координаты — ЛОКАЛЬНЫЕ (x — поперёк, z — вдоль оси секции); перевод в
 * мировые выполняет SectionChunk при build().
 */

/** Количество: `exact` — ровно столько, иначе randInt(min, max). */
export interface Bounds {
  exact?: number;
  min?: number;
  max?: number;
}

/** Ведьмы: либо точный список заклинаний (длина = число ведьм), либо число с процедурным выбором тем. */
export interface WitchPlacement {
  /** Точный список тем: встречаются РОВНО эти заклинания, по одному на ведьму. */
  spellIds?: string[];
  /** Число ведьм, когда темы выбираются процедурно (по слабости игрока). */
  count?: Bounds;
}

export interface SectionContentRule {
  bonfires?: Bounds;
  witches?: WitchPlacement | Bounds;
  practiceTargets?: Bounds;
  /** Точные сундуки (позиция + содержимое), либо только их число — содержимое подберёт процедура. */
  chests?: ChestSpec[] | Bounds;
  /** Плотность травы (сидов на метр длины; 0 — без травы). */
  grassDensity?: number;
  /** Плотность кустов внутри коридора (сидов на метр длины; 0 — без кустов). */
  bushDensity?: number;
}

export interface SectionContentContext {
  tier: number;
  isFirst: boolean;
}

export class SectionContentBuilder {
  constructor(
    private readonly rng: RandomFn,
    private readonly gameState: GameState,
    private readonly nextWitchId: () => string,
    private readonly nextChestId: () => string
  ) {}

  /**
   * Правило по умолчанию, выведенное из состояния игры: «что игроку нужно
   * видеть в следующей секции».
   */
  public static defaultRule(gameState: GameState, ctx: SectionContentContext): SectionContentRule {
    // Первая секция — узкий «входной шлюз» онбординга: костёр есть, врагов нет.
    if (ctx.isFirst || ctx.tier === 0) {
      return {
        bonfires: { exact: 1 },
        witches: { exact: 0 },
        practiceTargets: { min: 2, max: 4 },
        chests: [],
      };
    }

    // «Спокойная» секция: нечего учить (всё изучено до максимума) — случайные
    // бои больше не развивают, коридор успокаивается до одной проверочной ведьмы.
    const hasUnlockable = ALL_SPELLS.some((s) => gameState.isUnlockable(s));
    const allLearnedMaxed = gameState.getLearnedSpells().every((s) => gameState.getMastery(s.id) >= MAX_MASTERY);
    const calm = !hasUnlockable && allLearnedMaxed;

    return {
      bonfires: { exact: 1 }, // центр обучения — пока есть что учить
      witches: calm ? { exact: 1 } : { count: ctx.tier === 1 ? { min: 1, max: 2 } : { min: 2, max: 3 } },
      practiceTargets: { min: 2, max: 4 },
      // chests не задаём: apply() сам поставит сундук, пока есть что находить.
    };
  }

  /**
   * Содержимое перпендикулярной боковой ниши (см. WorldGenerator.SideSpurSpec):
   * ОДНА тема для охраняющей ведьмы (та же логика взвешивания по слабости
   * игрока, что и у обычных ведьм секции) + число слотов щедрого сундука-награды
   * (содержимое определяется при открытии). Возвращает `null`, если нишу нечем
   * наполнить — школы этого tier заперты (некому атаковать) или весь лор уже
   * найден (нечем награждать); в этом случае ниша в мире не появляется.
   */
  public buildSideSpurContent(tier: number): { spellId: string; chestSlots: number } | null {
    const pool = ALL_SPELLS.filter((s) => s.tier <= tier && this.gameState.isSchoolUnlocked(s.school));
    if (pool.length === 0) return null;
    if (!hasLootToFind(this.gameState)) return null;

    const spellId = pickWeightedByWeakness(this.rng, pool, this.gameState).id;
    return { spellId, chestSlots: SPUR_CHEST_SLOTS };
  }

  /** Применяет правило к секции, заполняя её массивы сущностей и декора. */
  public apply(spec: SectionSpec, rule: SectionContentRule): void {
    const merged: SectionContentRule = {
      ...SectionContentBuilder.defaultRule(this.gameState, { tier: spec.tier, isFirst: spec.index === 0 }),
      ...rule,
    };

    const width = spec.width;
    const length = spec.length;
    const placed: { x: number; z: number }[] = [];
    const lengthExtra = Math.floor(length / 40);

    // --- Костры: первый — у входа (как раньше), остальные — с разнесением. ---
    spec.bonfires = [];
    const bonfireCount = resolveCount(this.rng, merged.bonfires);
    for (let i = 0; i < bonfireCount; i++) {
      const pos =
        i === 0
          ? { x: randRange(this.rng, -(width / 2 - 1.5), width / 2 - 1.5), z: 2.5 }
          : pickSpacedPosition(this.rng, length, width, placed);
      placed.push(pos);
      // Первый костёр сохраняет старый id (ни на что не влияет, но не ломает привычки).
      spec.bonfires.push({ id: i === 0 ? `bonfire-${spec.index}` : `bonfire-${spec.index}-${i}`, x: pos.x, z: pos.z });
    }

    // --- Сундуки (ставим ДО ведьм: ведьмы спавнятся охранять сундуки). Точные
    // спеки (с содержимым) — как указано; иначе ставим динамические сундуки
    // (книги/страницы подбираются при открытии), пока игроку есть что находить.
    // По умолчанию — один сундук на секцию. ---
    spec.chests = [];
    if (Array.isArray(merged.chests)) {
      for (const c of merged.chests) {
        placed.push({ x: c.x, z: c.z });
        spec.chests.push({
          id: c.id,
          x: c.x,
          z: c.z,
          bookIds: [...c.bookIds],
          pageIds: [...c.pageIds],
          ...(c.dynamic ? { dynamic: { slots: c.dynamic.slots } } : {}),
        });
      }
    } else {
      const wanted = merged.chests ? resolveCount(this.rng, merged.chests) : 1;
      const count = hasLootToFind(this.gameState) ? wanted : 0;
      for (let i = 0; i < count; i++) {
        const pos = pickSpacedPosition(this.rng, length, width, placed);
        placed.push(pos);
        spec.chests.push({
          id: this.nextChestId(),
          x: pos.x,
          z: pos.z,
          bookIds: [],
          pageIds: [],
          dynamic: { slots: CORRIDOR_CHEST_SLOTS },
        });
      }
    }

    // --- Ведьмы: точные spellIds — ровно этот список; иначе число (Bounds) с
    // процедурным выбором тем по слабости игрока. ---
    spec.witches = [];
    const witchCfg = merged.witches;
    let witchCount: number;
    let spellOf: (i: number) => string;
    if (witchCfg && "spellIds" in witchCfg && witchCfg.spellIds) {
      witchCount = witchCfg.spellIds.length;
      spellOf = (i) => witchCfg.spellIds![i]!;
    } else if (witchCfg) {
      // Либо WitchPlacement со счётчиком, либо сразу Bounds — счётчик в .count ?? сам объект.
      const b: Bounds | undefined = (witchCfg as WitchPlacement).count ?? (witchCfg as Bounds);
      witchCount = resolveCount(this.rng, b, lengthExtra);
      const pool = ALL_SPELLS.filter((s) => s.tier <= spec.tier && this.gameState.isSchoolUnlocked(s.school));
      // Пустой пул (все школы заперты) — ведьм с боевой темой не бывает.
      if (pool.length === 0) witchCount = 0;
      spellOf = () => pickWeightedByWeakness(this.rng, pool, this.gameState).id;
    } else {
      witchCount = 0;
      spellOf = () => "";
    }
    // Первые ведьмы спавнятся рядом с сундуками (по GUARDS_PER_CHEST на сундук) и
    // потом гуляют вокруг этой точки (см. ai/witchBrain); остальные — как раньше,
    // в свободных местах коридора.
    const guardQueue: ChestSpec[] = spec.chests.flatMap((c) => Array<ChestSpec>(GUARDS_PER_CHEST).fill(c));
    for (let i = 0; i < witchCount; i++) {
      const chest = guardQueue.shift();
      const pos = chest
        ? pickGuardPosition(this.rng, length, width, placed, chest)
        : pickSpacedPosition(this.rng, length, width, placed);
      placed.push(pos);
      spec.witches.push({ id: this.nextWitchId(), x: pos.x, z: pos.z, spellId: spellOf(i) });
    }

    // --- Тренировочные цели. ---
    spec.practiceTargets = [];
    const practiceCount = resolveCount(this.rng, merged.practiceTargets, lengthExtra);
    for (let p = 0; p < practiceCount; p++) {
      const pos = pickSpacedPosition(this.rng, length, width, placed, 2.5);
      placed.push(pos);
      spec.practiceTargets.push({ id: `practice-${spec.index}-${p}`, x: pos.x, z: pos.z, kind: pick(this.rng, PRACTICE_KINDS) });
    }

    // --- Декор: трава, кусты и бордюры по стилю секции. ---
    // Плотность травы ×7 от прежней (3.2 → 22.4 сидов/м) — по ТЗ: "почаще".
    spec.grass = generateGrassSeeds(this.rng, length, width, merged.grassDensity ?? 22.4);
    // Кусты — редкие укрытия для стелса (игрок внутри невидим для ведьм), а не
    // ковёр: ~1 куст на 10 м коридора, разнесены друг от друга и от сущностей.
    // См. generateBushSeeds и SectionChunk.buildBushes.
    spec.bushes = generateBushSeeds(this.rng, length, width, merged.bushDensity ?? BUSH_DENSITY, placed);
    // Рощицы по 3–5 деревьев: ещё один вид укрытия (перекрывают обзор ведьм).
    spec.trees = generateTreeGroves(this.rng, length, width, [...placed, ...spec.bushes]);
    spec.borderLeft = generateBorderSeeds(this.rng, length, -(width / 2 - 0.4), spec.borderStyle);
    spec.borderRight = generateBorderSeeds(this.rng, length, width / 2 - 0.4, spec.borderStyle);
  }
}

// --- Утилиты ---

function resolveCount(rng: RandomFn, b: Bounds | undefined, lengthExtra = 0): number {
  if (!b) return 0;
  if (b.exact !== undefined) return b.exact;
  return randInt(rng, b.min ?? 0, b.max ?? 0) + lengthExtra;
}

const PRACTICE_KINDS: readonly ("tree" | "dummy" | "nettle")[] = ["tree", "dummy", "nettle"];

/**
 * Ищет позицию для сущности в локальных координатах секции, отстоящую минимум
 * на MIN_SPACING от уже размещённых точек — иначе они могут оказаться почти
 * друг на друге (баг: «бой перезапускается мгновенно»).
 */
const MIN_ENTITY_SPACING = 4.5;
function pickSpacedPosition(
  rng: RandomFn,
  length: number,
  width: number,
  placed: { x: number; z: number }[],
  minSpacing: number = MIN_ENTITY_SPACING
): { x: number; z: number } {
  const ATTEMPTS = 20;
  let best: { x: number; z: number } | null = null;
  let bestMinDist = -Infinity;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const candidate = { x: randRange(rng, -(width / 2 - 2), width / 2 - 2), z: randRange(rng, 2, length - 2) };
    let minDist = Infinity;
    for (const p of placed) {
      const d = Math.hypot(candidate.x - p.x, candidate.z - p.z);
      minDist = Math.min(minDist, d);
    }
    if (minDist >= minSpacing) return candidate;
    if (minDist > bestMinDist) {
      bestMinDist = minDist;
      best = candidate;
    }
  }
  return best!;
}

/** Сколько ведьм охраняет один сундук (остальные ведьмы секции стоят сами по себе). */
const GUARDS_PER_CHEST = 1;
/**
 * Кольцо спавна охранника вокруг сундука: дальше радиуса боя (2.0) — чтобы игрок у
 * сундука не оказывался сразу в драке, но достаточно близко, чтобы охранник
 * «ходил рядом» (радиус его прогулки — 2.2 м вокруг точки спавна).
 */
const GUARD_RING = { min: 2.6, max: 3.6 };

/**
 * Позиция ведьмы-охранника: на кольце вокруг своего сундука, с тем же разнесением
 * от всех остальных сущностей (сам сундук не считается). Не нашли за 20 попыток —
 * обычное разнесённое место.
 */
function pickGuardPosition(
  rng: RandomFn,
  length: number,
  width: number,
  placed: { x: number; z: number }[],
  chest: { x: number; z: number }
): { x: number; z: number } {
  const others = placed.filter((p) => p.x !== chest.x || p.z !== chest.z);
  for (let attempt = 0; attempt < 20; attempt++) {
    const angle = randRange(rng, 0, Math.PI * 2);
    const r = randRange(rng, GUARD_RING.min, GUARD_RING.max);
    const x = chest.x + Math.sin(angle) * r;
    const z = chest.z + Math.cos(angle) * r;
    if (Math.abs(x) > width / 2 - 2 || z < 2 || z > length - 2) continue;
    if (others.every((p) => Math.hypot(x - p.x, z - p.z) >= MIN_ENTITY_SPACING)) return { x, z };
  }
  return pickSpacedPosition(rng, length, width, placed);
}

/** Чем ниже мастерство темы у игрока, тем выше шанс встретить ведьму именно с ней. */
function pickWeightedByWeakness(rng: RandomFn, pool: { id: string }[], gameState: GameState): { id: string } {
  const weights = pool.map((s) => MAX_MASTERY + 1 - gameState.getMastery(s.id));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function generateGrassSeeds(rng: RandomFn, length: number, width: number, density: number): ScatterSeed[] {
  const count = Math.round(length * density);
  const seeds: ScatterSeed[] = [];
  for (let i = 0; i < count; i++) {
    seeds.push({
      x: randRange(rng, -(width / 2 - 0.6), width / 2 - 0.6),
      z: randRange(rng, 0, length),
      rot: randRange(rng, 0, Math.PI * 2),
      scale: randRange(rng, 0.7, 1.3),
    });
  }
  return seeds;
}

/** Кустов на метр длины секции (было 0.35 — перекрывали карту). */
const BUSH_DENSITY = 0.1;
/** Размер куста: scale × диаметр 2.4 → диаметр 1.9–2.5 м, высота ≥ 1.92 м (выше игрока, 1.8 м). */
const BUSH_SCALE = { min: 0.8, max: 1.05 };
/** Минимум кустов на секцию — чтобы всегда было где спрятаться. */
const BUSH_MIN_COUNT = 2;
/** Куст не ставим ближе этого к ведьме/сундуку/костру/цели (иначе закроет их или сольётся с ними). */
const BUSH_ENTITY_CLEARANCE = 3;
/** Минимум между центрами кустов — равномерно, без «зарослей». */
const BUSH_MIN_SPACING = 6;

/**
 * Кусты внутри проходимой ширины (не бордюрные) — укрытия для стелса. Мало,
 * небольшие (но выше игрока), расставлены разреженно и не на сущностях.
 * Коллизии нет — игрок заходит внутрь и становится невидимым для ведьм.
 * Если свободного места не нашлось за 12 попыток — куст пропускается (лучше
 * на один меньше, чем на ведьме).
 */
function generateBushSeeds(
  rng: RandomFn,
  length: number,
  width: number,
  density: number,
  avoid: readonly { x: number; z: number }[]
): ScatterSeed[] {
  const count = Math.max(BUSH_MIN_COUNT, Math.round(length * density));
  const seeds: ScatterSeed[] = [];
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = randRange(rng, -(width / 2 - 1.4), width / 2 - 1.4);
      const z = randRange(rng, 0.5, length - 0.5);
      const farFromEntities = avoid.every((p) => Math.hypot(x - p.x, z - p.z) >= BUSH_ENTITY_CLEARANCE);
      const farFromBushes = seeds.every((b) => Math.hypot(x - b.x, z - b.z) >= BUSH_MIN_SPACING);
      if (!farFromEntities || !farFromBushes) continue;
      seeds.push({
        x,
        z,
        rot: randRange(rng, 0, Math.PI * 2),
        scale: randRange(rng, BUSH_SCALE.min, BUSH_SCALE.max),
      });
      break;
    }
  }
  return seeds;
}

/** Рощиц на метр длины секции (≈1–2 на коридор). */
const GROVE_DENSITY = 0.04;
/** Деревьев в рощице. */
const GROVE_TREES = { min: 3, max: 5 };
/** Размер дерева: scale × (крона Ø2.2, высота ≈3.1) → 2.6–3.7 м. */
const TREE_SCALE = { min: 0.85, max: 1.2 };
/** Между стволами в рощице не меньше (пройти между ними можно, но тесно). */
const TREE_MIN_SPACING = 1.7;
/** Дерево рощицы лежит не дальше этого от её центра. */
const GROVE_RADIUS = 2.6;
/** Центр рощицы не ближе этого к сущностям и кустам (радиус рощицы + запас). */
const GROVE_CLEARANCE = 4.5;
/** Между центрами рощиц. */
const GROVE_MIN_SPACING = 10;

/**
 * Рощицы: кучки по 3–5 деревьев внутри проходимой ширины. Служат укрытием от
 * взгляда ведьм и стоят стволом (коллизия). Возвращает плоский список деревьев.
 * Если места не нашлось за 20 попыток — рощица пропускается; рощица, в которой
 * не уместилось даже 3 дерева, отбрасывается целиком (одинокое дерево — не укрытие).
 */
function generateTreeGroves(
  rng: RandomFn,
  length: number,
  width: number,
  avoid: readonly { x: number; z: number }[]
): ScatterSeed[] {
  const groveCount = Math.max(1, Math.round(length * GROVE_DENSITY));
  const xLimit = width / 2 - 2.2; // у стены — бордюр, деревья к нему вплотную не жмём
  const trees: ScatterSeed[] = [];
  const centers: { x: number; z: number }[] = [];

  for (let g = 0; g < groveCount; g++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const cx = randRange(rng, -(xLimit - 1), xLimit - 1);
      const cz = randRange(rng, 3, length - 3);
      if (!avoid.every((p) => Math.hypot(cx - p.x, cz - p.z) >= GROVE_CLEARANCE)) continue;
      if (!centers.every((c) => Math.hypot(cx - c.x, cz - c.z) >= GROVE_MIN_SPACING)) continue;

      const target = GROVE_TREES.min + Math.floor(rng() * (GROVE_TREES.max - GROVE_TREES.min + 1));
      const group: { x: number; z: number }[] = [{ x: cx, z: cz }];
      for (let k = 0; k < 40 && group.length < target; k++) {
        const a = randRange(rng, 0, Math.PI * 2);
        const r = randRange(rng, TREE_MIN_SPACING, GROVE_RADIUS);
        const x = cx + Math.sin(a) * r;
        const z = cz + Math.cos(a) * r;
        if (Math.abs(x) > xLimit || z < 1 || z > length - 1) continue;
        if (group.every((p) => Math.hypot(x - p.x, z - p.z) >= TREE_MIN_SPACING)) group.push({ x, z });
      }
      if (group.length < GROVE_TREES.min) continue;

      centers.push({ x: cx, z: cz });
      for (const p of group) {
        trees.push({
          x: p.x,
          z: p.z,
          rot: randRange(rng, 0, Math.PI * 2),
          scale: randRange(rng, TREE_SCALE.min, TREE_SCALE.max),
        });
      }
      break;
    }
  }
  return trees;
}

function generateBorderSeeds(rng: RandomFn, length: number, x: number, style: BorderStyle): ScatterSeed[] {
  const seeds: ScatterSeed[] = [];
  // Забор — регулярные столбы почти без пропусков; кусты/скалы — органичнее, с разбросом.
  const [gapMin, gapMax, jitter] = style === "fence" ? [1.6, 2.0, 0.1] : [2, 3.5, 0.25];
  let z = randRange(rng, 0.5, 2);
  while (z < length) {
    seeds.push({ x: x + randRange(rng, -jitter, jitter), z, rot: randRange(rng, 0, Math.PI * 2), scale: randRange(rng, 0.8, 1.3) });
    z += randRange(rng, gapMin, gapMax);
  }
  return seeds;
}