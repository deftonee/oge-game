import { ALL_SPELLS } from "../data/spells";
import { ALL_BOOKS } from "../data/books";
import { GameState, MAX_MASTERY } from "../core/GameState";
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
 *    - сундук появляется, только пока есть НЕ СОБРАННЫЕ страницы книг, и
 *      содержит именно их (после сбора всего лора сундуки исчезают);
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
      // chests не задаём: apply() сам поставит сундук, пока есть не собранные страницы.
    };
  }

  /**
   * Содержимое перпендикулярной боковой ниши (см. WorldGenerator.SideSpurSpec):
   * ОДНА тема для охраняющей ведьмы (та же логика взвешивания по слабости
   * игрока, что и у обычных ведьм секции) + ОДНА группа не собранных страниц
   * книги для сундука. Возвращает `null`, если нишу нечем наполнить —
   * школы этого tier заперты (некому атаковать) или весь лор уже собран
   * (нечем награждать); в этом случае ниша в мире не появляется.
   */
  public buildSideSpurContent(tier: number): { spellId: string; book: { bookId: string; pageIds: string[] } } | null {
    const pool = ALL_SPELLS.filter((s) => s.tier <= tier && this.gameState.isSchoolUnlocked(s.school));
    if (pool.length === 0) return null;

    const groups = uncollectedPageGroups(this.gameState);
    if (groups.length === 0) return null;

    const spellId = pickWeightedByWeakness(this.rng, pool, this.gameState).id;
    const group = pick(this.rng, groups);
    return { spellId, book: { bookId: group.bookId, pageIds: [...group.pageIds] } };
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
    for (let i = 0; i < witchCount; i++) {
      const pos = pickSpacedPosition(this.rng, length, width, placed);
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

    // --- Сундуки: точные спеки (с содержимым) — как указано; иначе содержимое
    // берётся из состояния игры — не собранные страницы книг. ---
    spec.chests = [];
    if (Array.isArray(merged.chests)) {
      for (const c of merged.chests) {
        placed.push({ x: c.x, z: c.z });
        spec.chests.push({ id: c.id, x: c.x, z: c.z, bookIds: [...c.bookIds], pageIds: [...c.pageIds] });
      }
    } else {
      const groups = uncollectedPageGroups(this.gameState);
      const count = merged.chests ? resolveCount(this.rng, merged.chests) : groups.length;
      for (let i = 0; i < Math.min(count, groups.length); i++) {
        const g = groups[i];
        const pos = pickSpacedPosition(this.rng, length, width, placed);
        placed.push(pos);
        spec.chests.push({ id: this.nextChestId(), x: pos.x, z: pos.z, bookIds: [g.bookId], pageIds: g.pageIds });
      }
    }

    // --- Декор: трава, кусты и бордюры по стилю секции. ---
    // Плотность травы ×7 от прежней (3.2 → 22.4 сидов/м) — по ТЗ: "почаще".
    spec.grass = generateGrassSeeds(this.rng, length, width, merged.grassDensity ?? 22.4);
    // Кусты — заметно реже травы (отдельные ориентиры/будущие укрытия, а не
    // ковёр) и крупнее — см. generateBushSeeds и SectionChunk.buildScatter.
    spec.bushes = generateBushSeeds(this.rng, length, width, merged.bushDensity ?? 0.15);
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

/** Сундуки: группы по книгам, у которых есть НЕ СОБРАННЫЕ игроком страницы. */
function uncollectedPageGroups(gameState: GameState): { bookId: string; pageIds: string[] }[] {
  const groups: { bookId: string; pageIds: string[] }[] = [];
  for (const book of ALL_BOOKS) {
    const pageIds = book.pages.map((p) => p.id).filter((id) => !gameState.hasBookPage(id));
    if (pageIds.length > 0) groups.push({ bookId: book.id, pageIds });
  }
  return groups;
}

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

/**
 * Кусты внутри проходимой ширины (не бордюрные) — задел под будущую
 * механику пряток игрока: расставлены РЕДКО и с бОльшим случайным
 * масштабом, чтобы читаться как отдельные укрытия-ориентиры, а не как
 * ковёр (как трава). Сейчас чисто декоративны (без коллизии) — то же
 * ограничение, что и у травы/бордюров, до появления самой механики.
 */
function generateBushSeeds(rng: RandomFn, length: number, width: number, density: number): ScatterSeed[] {
  const count = Math.round(length * density);
  const seeds: ScatterSeed[] = [];
  for (let i = 0; i < count; i++) {
    seeds.push({
      x: randRange(rng, -(width / 2 - 0.9), width / 2 - 0.9),
      z: randRange(rng, 0, length),
      rot: randRange(rng, 0, Math.PI * 2),
      scale: randRange(rng, 0.85, 1.5),
    });
  }
  return seeds;
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