import { ALL_SPELLS, getSpellsBySchool, Spell } from "../data/spells";
import { GameState, MAX_MASTERY } from "../core/GameState";


export interface WitchSpec {
  id: string;
  /** Локальная координата поперёк коридора. */
  x: number;
  /** Локальная координата вдоль коридора (0 = вход секции). */
  z: number;
  spellId: string;
}

export interface BonfireSpec {
  id: string;
  x: number;
  z: number;
}

export interface ScatterSeed {
  x: number;
  z: number;
  rot: number;
  scale: number;
}

export type PracticeTargetKind = "tree" | "dummy" | "nettle";

export interface PracticeTargetSpec {
  id: string;
  x: number;
  z: number;
  kind: PracticeTargetKind;
}

/**
 * Выходные ворота секции (стоят на её КОНЦЕ). У секции их 0..2:
 *   0 — только у служебной секции подхода к башне (дальше туман и башня),
 *   1 — обычный проход в следующую секцию,
 *   2 — развилка: два барьера по половине коридора на разные ветки прокачки.
 */
export interface GateSpec {
  id: string;
  /** Сколько тем нужно изучить суммарно (по любой школе), чтобы пробить барьер. */
  requiredSpells: number;
  /** Ветка прокачки (школа), к которой ведут ворота — тематика барьера. */
  schoolId: string | null;
  /** Локальный x центра барьера (0 — одиночные ворота; ±width/4 — развилка). */
  x: number;
  /** Ширина барьера. */
  width: number;
  /** Ворота развилки: после открытия проход только вперёд (односторонний блок). */
  fork?: boolean;
}

export type BorderStyle = "bushes" | "fence" | "mountains";

export interface SectionSpec {
  index: number;
  tier: number; // 1-3 сложность; 0 — служебная секция подхода к башне, без врагов
  color: string;
  borderStyle: BorderStyle;
  /** Протяжённость секции вдоль её собственной оси (локальные z: 0..length). */
  length: number;
  /** Ширина коридора секции (первая секция — узкий вход; остальные 3×). */
  width: number;
  /** Мировая точка начала осевой линии секции (локальный (0, 0)). */
  start: { x: number; z: number };
  /** Мировая точка конца осевой линии секции (локальный (0, length)). */
  end: { x: number; z: number };
  /** Направление коридора в мире, рад (0 = +Z). */
  yaw: number;
  /** Выходные ворота на конце секции (см. GateSpec). */
  gates: GateSpec[];
  /** Длина средней стены-разделителя после развилки (0 — обычная секция). */
  partitionDepth: number;
  /** Радиус диска-заплатки на стыке с предыдущей секцией (0 если стык прямой). */
  jointRadius: number;
  /** Параметры предыдущей секции для стыка-заплатки (см. SectionChunk.buildJointPatch). */
  prevYaw: number;
  prevWidth: number;
  prevColor: string;
  prevEnd: { x: number; z: number };
  /** Признак ветки развилки: A/B параллельные коридоры за двойными воротами. */
  forkBranch?: "a" | "b";
  /** Id ворот родительской секции, через которые входят в эту ветку. */
  forkGateId?: string;
  /** Индекс родительской секции (строить ветку, пока игрок у развилки или прошёл ворота). */
  forkParentIndex?: number;
  witches: WitchSpec[];
  bonfires: BonfireSpec[];
  practiceTargets: PracticeTargetSpec[];
  grass: ScatterSeed[];
  borderLeft: ScatterSeed[];
  borderRight: ScatterSeed[];
}

export interface WorldSpec {
  sections: SectionSpec[];
  spawnPoint: { x: number; y: number; z: number };
  tower: { x: number; z: number };
}

// Первая секция — узкий «входной шлюз» для мягкого онбординга.
export const FIRST_SECTION_WIDTH = 8;
// Остальные секции — ровно в 3 раза шире (п.доработок: «шире … раза в 3»).
export const SECTION_WIDTH = FIRST_SECTION_WIDTH * 3;
const FIRST_SECTION_LENGTH = { min: 12, max: 18 };
const SECTION_LENGTH = { min: 36, max: 54 }; // 12-18 × 3

/** Максимальный изгиб на стыке секций в рад (~17°). */
const MAX_BEND = 0.3;
/** Потолок накопленного изгиба трассы, чтобы коридор не закручивался в спираль. */
const MAX_YAW = 1.05;
/** Вероятность, что секция закончится развилкой (двумя воротами). */
const FORK_PROBABILITY = 0.45;
/** Доля ширины коридора, которую закрывает один барьер при развилке. */
const FORK_GATE_FRACTION = 0.5;
/** Длина параллельных коридоров-веток за развилкой (до схождения в общую секцию). */
const FORK_BRANCH_LENGTH = { min: 22, max: 38 };

const TIER_COLORS: Record<number, string> = {
  1: "#3f7d3a", // сочная трава — простые темы
  2: "#356b57", // глубже, спокойнее — темы посложнее
  3: "#3c4f68", // сумеречный оттенок перед финалом
};
const APPROACH_COLOR = "#2c3550";

// --- Простой детерминированный PRNG (mulberry32), чтобы генерация была
// воспроизводимой при известном seed и не зависела от Math.random напрямую ---
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}
function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(randRange(rng, min, max + 1));
}
function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

const BORDER_STYLES: readonly BorderStyle[] = ["bushes", "fence", "mountains"];
const PRACTICE_KINDS: readonly PracticeTargetKind[] = ["tree", "dummy", "nettle"];

/**
 * Уровень барьера: доля от ВСЕГО числа заклинаний, зависящая от сложности
 * секции (tier 1-3). С ростом контента (добавление школ) пороги масштабируются
 * сами — линейная треть на каждый тир.
 */
function gateRequiredSpells(tier: number, totalSpells: number): number {
  return Math.max(1, Math.min(totalSpells, Math.ceil((totalSpells * tier) / 6)));
}

/** Перевод локальных координат секции (x — поперёк, z — вдоль) в мировые. */
export function localToWorld(section: Pick<SectionSpec, "start" | "yaw">, localX: number, localZ: number): { x: number; z: number } {
  const dirX = Math.sin(section.yaw);
  const dirZ = Math.cos(section.yaw);
  const perpX = Math.cos(section.yaw);
  const perpZ = -Math.sin(section.yaw);
  return {
    x: section.start.x + localZ * dirX + localX * perpX,
    z: section.start.z + localZ * dirZ + localX * perpZ,
  };
}

/** Расстояние от точки до отрезка (для поиска секции по мировой позиции игрока). */
export function distPointToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  let t = 0;
  if (lenSq > 1e-12) {
    t = clamp(((px - ax) * dx + (pz - az) * dz) / lenSq, 0, 1);
  }
  const cx = ax + dx * t;
  const cz = az + dz * t;
  return Math.hypot(px - cx, pz - cz);
}

/**
 * Выбор школ-тем для ворот секции. Тематика — «ветки прокачки заклинаний»:
 * чем меньше школа отработана (суммарное мастерство её спеллов) и чем реже она
 * уже назначалась воротам в этом прогоне генерации, тем выше шанс, что очередные
 * ворота отправят игрока именно в неё. Так после выбора ветки следующие ворота
 * переключаются на ещё не отработанные школы.
 */
function pickGateSchools(rng: () => number, gameState: GameState, used: Map<string, number>, count: 1 | 2): string[] {
  // Темой ворот может быть только школа с реальным контентом (спеллами):
  // пустая ветка не даст игроку отработать её у барьера.
  const schools = gameState.getUnlockedSchools().filter((s) => getSpellsBySchool(s.id).length > 0);
  const scored = schools
    .map((s) => {
      const practice = ALL_SPELLS.filter((sp) => sp.school === s.id).reduce((sum, sp) => sum + gameState.getMastery(sp.id), 0);
      const load = used.get(s.id) ?? 0;
      const weight = (1 / (1 + load * 2.5 + practice * 0.5)) * (0.8 + rng() * 0.4);
      return { id: s.id, weight };
    })
    .sort((a, b) => b.weight - a.weight);

  const chosen = scored.slice(0, count).map((s) => s.id);
  for (const id of chosen) used.set(id, (used.get(id) ?? 0) + 1);
  return chosen;
}

/** Назначает выходные ворота секции: forceFork=true — принудительно развилка. */
function assignExitGates(
  spec: SectionSpec,
  rng: () => number,
  gameState: GameState,
  used: Map<string, number>,
  forceFork: boolean
): void {
  const fork = forceFork;
  const schools = pickGateSchools(rng, gameState, used, fork ? 2 : 1);
  const required = gateRequiredSpells(spec.tier, ALL_SPELLS.length);

  if (fork) {
    const gateWidth = spec.width * FORK_GATE_FRACTION - 0.3;
    spec.gates = [
      { id: `gate-${spec.index}-a`, requiredSpells: required, schoolId: schools[0], x: -spec.width / 4, width: gateWidth, fork: true },
      { id: `gate-${spec.index}-b`, requiredSpells: required, schoolId: schools[1] ?? schools[0], x: spec.width / 4, width: gateWidth, fork: true },
    ];
  } else {
    spec.gates = [{ id: `gate-${spec.index}`, requiredSpells: required, schoolId: schools[0], x: 0, width: spec.width - 0.4 }];
  }
}

/**
 * Процедурная генерация коридора (п.5 ТЗ + доработки): каждый запуск с новым
 * seed даёт другое число и длину секций, другую расстановку ведьм и декора.
 *
 * Доработки генерации:
 * - Первая секция — узкий шлюз БЕЗ ведьм: мягкий вход в игровой процесс.
 * - Остальные секции в 3 раза шире и длиннее, трасса изгибается (случайные
 *   повороты yaw со сглаживанием и потолком, чтобы не закручивалась).
 * - Иногда секция заканчивается ДВУМЯ воротами-развилкой на разные ветки
 *   прокачки (школы); следующая секция делится средней стеной-разделителем.
 * - Тематика ворот = школа; выбирается по принципу «наименее отработанных»
 *   веток с анти-повтором внутри прогона.
 * - Стыки изогнутых секций закрываются дисками-заплатками (jointRadius).
 */
export function generateWorld(gameState: GameState, seed: number = Date.now()): WorldSpec {
  const rng = mulberry32(seed);
  const mainSectionCount = randInt(rng, 5, 7);
  const gateSchoolUsage = new Map<string, number>();

  const sections: SectionSpec[] = [];
  let cursor = { x: 0, z: 0 }; // мировая точка конца текущего коридора
  let yaw = 0;
  let specIndex = 0;
  let prevSpec: SectionSpec | null = null;
  let witchCounter = 0;

  /** Нормализация угла в [-π, π]. */
  const normAngle = (a: number): number => {
    let r = a % (Math.PI * 2);
    if (r > Math.PI) r -= Math.PI * 2;
    if (r < -Math.PI) r += Math.PI * 2;
    return r;
  };

  /** Базовая секция (без сущностей); joint-параметры считаются по prev. */
  const makeSection = (
    index: number,
    tier: number,
    width: number,
    length: number,
    start: { x: number; z: number },
    end: { x: number; z: number },
    sectionYaw: number,
    prev: SectionSpec | null
  ): SectionSpec => {
    const delta = prev ? Math.abs(normAngle(sectionYaw - prev.yaw)) : 0;
    return {
      index,
      tier,
      color: TIER_COLORS[tier] ?? TIER_COLORS[3],
      borderStyle: pick(rng, BORDER_STYLES),
      length,
      width,
      start,
      end,
      yaw: sectionYaw,
      gates: [],
      partitionDepth: 0,
      // Прямой стык (вилочные ветки, схождение) — клина нет; изгиб — клин.
      jointRadius: prev && delta > 0.02 ? jointRadiusFor(prev, { yaw: sectionYaw, width }) : 0,
      prevYaw: prev ? prev.yaw : 0,
      prevWidth: prev ? prev.width : 0,
      prevColor: prev ? prev.color : "",
      prevEnd: prev ? { x: prev.end.x, z: prev.end.z } : { x: 0, z: 0 },
      witches: [],
      bonfires: [],
      practiceTargets: [],
      grass: [],
      borderLeft: [],
      borderRight: [],
    };
  };

  /** Заполняет секцию сущностями и декором (все координаты локальные). */
  const fillSection = (spec: SectionSpec, isFirst: boolean): void => {
    const width = spec.width;
    const length = spec.length;
    const placed: { x: number; z: number }[] = [];
    const bonfireSpot = { x: randRange(rng, -(width / 2 - 1.5), width / 2 - 1.5), z: 2.5 };
    placed.push(bonfireSpot);

    spec.witches = [];
    if (!isFirst) {
      const spellPool = ALL_SPELLS.filter((s) => s.tier <= spec.tier && gameState.isSchoolUnlocked(s.school));
      const witchCount = randInt(rng, spec.tier === 1 ? 1 : 2, spec.tier === 1 ? 2 : 3) + Math.floor(length / 40);
      for (let w = 0; w < witchCount; w++) {
        const spell = pickWeightedByWeakness(rng, spellPool, gameState);
        const pos = pickSpacedPosition(rng, length, width, placed);
        placed.push(pos);
        spec.witches.push({ id: `witch-${witchCounter++}`, x: pos.x, z: pos.z, spellId: spell.id });
      }
    }

    spec.bonfires = [{ id: `bonfire-${spec.index}`, x: bonfireSpot.x, z: bonfireSpot.z }];

    const practiceCount = randInt(rng, 2, 4) + Math.floor(length / 40);
    spec.practiceTargets = [];
    for (let p = 0; p < practiceCount; p++) {
      const pos = pickSpacedPosition(rng, length, width, placed, 2.5);
      placed.push(pos);
      spec.practiceTargets.push({ id: `practice-${spec.index}-${p}`, x: pos.x, z: pos.z, kind: pick(rng, PRACTICE_KINDS) });
    }

    spec.grass = generateGrassSeeds(rng, length, width);
    const borderStyle = spec.borderStyle;
    spec.borderLeft = generateBorderSeeds(rng, length, -(width / 2 - 0.4), borderStyle);
    spec.borderRight = generateBorderSeeds(rng, length, width / 2 - 0.4, borderStyle);
  };

  let worldCount = 0; // стволовых секций (parent + схождения J)
  while (worldCount < mainSectionCount) {
    const isFirst = worldCount === 0;
    const last = worldCount === mainSectionCount - 1;
    const width = isFirst ? FIRST_SECTION_WIDTH : SECTION_WIDTH;
    const length = isFirst
      ? randRange(rng, FIRST_SECTION_LENGTH.min, FIRST_SECTION_LENGTH.max)
      : randRange(rng, SECTION_LENGTH.min, SECTION_LENGTH.max);
    const tier = Math.min(3, Math.floor((worldCount / mainSectionCount) * 3) + 1);

    if (!isFirst) {
      // Изгиб трассы: случайный поворот, ограниченный потолком накопленного угла.
      yaw = clamp(yaw + randRange(rng, -MAX_BEND, MAX_BEND), -MAX_YAW, MAX_YAW);
    }

    const end = localToWorld({ start: cursor, yaw }, 0, length);
    const parent = makeSection(specIndex, tier, width, length, { x: cursor.x, z: cursor.z }, end, yaw, prevSpec);
    fillSection(parent, isFirst);

    const forkAllowed =
      !isFirst &&
      !last &&
      gameState.getUnlockedSchools().filter((s) => getSpellsBySchool(s.id).length > 0).length >= 2;
    const fork = forkAllowed && rng() < FORK_PROBABILITY;

    if (fork) {
      assignExitGates(parent, rng, gameState, gateSchoolUsage, true);

      // --- Две ПАРАЛЛЕЛЬНЫЕ ветки за двойными воротами (см. ТЗ): каждая
      // половинка коридора шириной w/2 идёт своим рукавом; концы обеих
      // лежат на одной кромке — туда встык приходит общая секция J. ---
      const branchLen = randRange(rng, FORK_BRANCH_LENGTH.min, FORK_BRANCH_LENGTH.max);
      const dirX = Math.sin(yaw);
      const dirZ = Math.cos(yaw);
      const perpX = Math.cos(yaw);
      const perpZ = -Math.sin(yaw);
      const off = SECTION_WIDTH / 4;
      const branchTier = Math.min(3, tier + 1);

      const mkBranch = (branch: "a" | "b", sign: number, gateId: string): SectionSpec => {
        const start = { x: cursor.x - perpX * off * sign, z: cursor.z - perpZ * off * sign };
        const branchEnd = { x: start.x + dirX * branchLen, z: start.z + dirZ * branchLen };
        const spec = makeSection(specIndex + 1, branchTier, SECTION_WIDTH / 2, branchLen, start, branchEnd, yaw, parent);
        spec.forkBranch = branch;
        spec.forkGateId = gateId;
        spec.forkParentIndex = parent.index;
        fillSection(spec, false);
        return spec;
      };
      const branchA = mkBranch("a", 1, parent.gates[0].id);
      const branchB = mkBranch("b", -1, parent.gates[1].id);

      // Общая секция-схождение: вход J — одна кромка с концами обеих веток.
      const jStart = { x: cursor.x + dirX * branchLen, z: cursor.z + dirZ * branchLen };
      const jLength = randRange(rng, SECTION_LENGTH.min, SECTION_LENGTH.max);
      const jEnd = localToWorld({ start: jStart, yaw }, 0, jLength);
      const join = makeSection(specIndex + 2, tier, SECTION_WIDTH, jLength, jStart, jEnd, yaw, branchA);
      fillSection(join, false);

      sections.push(parent, branchA, branchB, join);
      prevSpec = join;
      cursor = jEnd;
      specIndex += 3;
      worldCount += 2; // parent + J — две стволовые позиции
    } else {
      if (!last) assignExitGates(parent, rng, gameState, gateSchoolUsage, false);
      sections.push(parent);
      prevSpec = parent;
      cursor = end;
      specIndex += 1;
      worldCount += 1;
    }
  }

  // --- Финальная секция — спокойный подход к башне, без врагов, без выхода ---
  yaw = clamp(yaw + randRange(rng, -MAX_BEND, MAX_BEND), -MAX_YAW, MAX_YAW);
  const approachLength = randRange(rng, SECTION_LENGTH.min, SECTION_LENGTH.max);
  const approachStart = { x: cursor.x, z: cursor.z };
  const approachEnd = localToWorld({ start: approachStart, yaw }, 0, approachLength);
  if (prevSpec) {
    // Вход в подход гейтится одиночным барьером от последней боевой секции.
    const schools = pickGateSchools(rng, gameState, gateSchoolUsage, 1);
    prevSpec.gates = [
      {
        id: "gate-approach",
        requiredSpells: gateRequiredSpells(prevSpec.tier, ALL_SPELLS.length),
        schoolId: schools[0],
        x: 0,
        width: prevSpec.width - 0.4,
      },
    ];
  }
  const approach = makeSection(specIndex, 0, SECTION_WIDTH, approachLength, approachStart, approachEnd, yaw, prevSpec);
  approach.color = APPROACH_COLOR;
  approach.witches = [];
  approach.bonfires = [];
  approach.practiceTargets = [];
  approach.grass = generateGrassSeeds(rng, approachLength, SECTION_WIDTH);
  const approachBorderStyle = approach.borderStyle;
  approach.borderLeft = generateBorderSeeds(rng, approachLength, -(SECTION_WIDTH / 2 - 0.4), approachBorderStyle);
  approach.borderRight = generateBorderSeeds(rng, approachLength, SECTION_WIDTH / 2 - 0.4, approachBorderStyle);
  sections.push(approach);

  const spawnLocal = localToWorld(sections[0], 0, 2.5);
  const towerLocal = localToWorld(approach, 0, approachLength + 2);

  return {
    sections,
    spawnPoint: { x: spawnLocal.x, y: 1, z: spawnLocal.z },
    tower: { x: towerLocal.x, z: towerLocal.z },
  };
}

/** Радиус диска-заплатки, закрывающего зазор между двумя изогнутыми секциями. */
function jointRadiusFor(prev: SectionSpec, cur: { yaw: number; width: number }): number {
  const diff = Math.abs(cur.yaw - prev.yaw) / 2;
  return Math.max(prev.width, cur.width) / 2 / Math.cos(diff) + 0.6;
}

/**
 * Ищет позицию для сущности в локальных координатах секции, отстоящую минимум
 * на MIN_SPACING от уже размещённых точек — иначе они могут оказаться почти
 * друг на друге (баг: «бой перезапускается мгновенно»).
 */
const MIN_ENTITY_SPACING = 4.5;
function pickSpacedPosition(
  rng: () => number,
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
function pickWeightedByWeakness(rng: () => number, pool: Spell[], gameState: GameState): Spell {
  const weights = pool.map((s) => MAX_MASTERY + 1 - gameState.getMastery(s.id));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function generateGrassSeeds(rng: () => number, length: number, width: number): ScatterSeed[] {
  const density = 3.2; // тufтов на метр длины секции
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

function generateBorderSeeds(rng: () => number, length: number, x: number, style: BorderStyle): ScatterSeed[] {
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