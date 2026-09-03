import { ALL_SPELLS, Spell } from "../data/spells";
import { GameState, MAX_MASTERY } from "../core/GameState";

export interface WitchSpec {
  id: string;
  x: number;
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

export interface GateSpec {
  id: string;
  /** Сколько тем нужно изучить суммарно (по любой школе), чтобы пробить барьер. */
  requiredSpells: number;
}

export type BorderStyle = "bushes" | "fence" | "mountains";

export interface SectionSpec {
  index: number;
  startZ: number;
  endZ: number;
  length: number;
  tier: number; // 1-3 сложность; 0 — служебная секция подхода к башне, без врагов
  color: string;
  borderStyle: BorderStyle;
  gateAtStart: GateSpec | null;
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
  towerZ: number;
  corridorWidth: number;
}

export const CORRIDOR_WIDTH = 8;

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

/**
 * Процедурная генерация коридора (п.5 ТЗ): каждый запуск с новым seed даёт
 * другое число и длину секций, другую расстановку ведьм и декора. Секции
 * стыкуются встык (endZ одной == startZ следующей) — разрывов в полу нет.
 * Тема атаки ведьмы выбирается с уклоном в темы, которые игрок хуже освоил
 * (п.5 ТЗ: "чаще подсовывать врагов для отработки слабо изученных заклинаний").
 */
export function generateWorld(gameState: GameState, seed: number = Date.now()): WorldSpec {
  const rng = mulberry32(seed);
  const sectionCount = randInt(rng, 5, 7);

  let cursorZ = -4; // буфер перед первой секцией, чтобы точка спавна стояла на полу
  const sections: SectionSpec[] = [];
  let witchCounter = 0;
  let previousTier: number | null = null; // тир предыдущей секции — им гейтится вход в следующую

  for (let i = 0; i < sectionCount; i++) {
    const tier = Math.min(3, Math.floor((i / sectionCount) * 3) + 1);
    const length = randRange(rng, 12, 18);
    const startZ = cursorZ;
    const endZ = startZ + length;
    const gateAtStart: GateSpec | null =
      previousTier !== null ? { id: `gate-${i}`, requiredSpells: gateRequiredSpells(previousTier, ALL_SPELLS.length) } : null;

    // Пул тем секции: не сложнее тира секции И из открытых школ
    // (Школа тайн не подсовывает ведьм, пока не выучены мосты).
    const spellPool = ALL_SPELLS.filter((s) => s.tier <= tier && gameState.isSchoolUnlocked(s.school));
    const witchCount = randInt(rng, 1, tier === 1 ? 2 : 3);
    const bonfireSpot = { x: randRange(rng, -1.5, 1.5), z: startZ + 2.5 };
    const witches: WitchSpec[] = [];
    const placed: { x: number; z: number }[] = [bonfireSpot];
    for (let w = 0; w < witchCount; w++) {
      const spell = pickWeightedByWeakness(rng, spellPool, gameState);
      const pos = pickSpacedPosition(rng, startZ, endZ, placed);
      placed.push(pos);
      witches.push({ id: `witch-${witchCounter++}`, x: pos.x, z: pos.z, spellId: spell.id });
    }

    const bonfires: BonfireSpec[] = [{ id: `bonfire-${i}`, x: bonfireSpot.x, z: bonfireSpot.z }];

    const practiceCount = randInt(rng, 2, 4);
    const practiceTargets: PracticeTargetSpec[] = [];
    for (let p = 0; p < practiceCount; p++) {
      const pos = pickSpacedPosition(rng, startZ, endZ, placed, 2.5);
      placed.push(pos);
      practiceTargets.push({ id: `practice-${i}-${p}`, x: pos.x, z: pos.z, kind: pick(rng, PRACTICE_KINDS) });
    }

    const borderStyle = pick(rng, BORDER_STYLES);

    sections.push({
      index: i,
      startZ,
      endZ,
      length,
      tier,
      color: TIER_COLORS[tier] ?? TIER_COLORS[3],
      borderStyle,
      gateAtStart,
      witches,
      bonfires,
      practiceTargets,
      grass: generateGrassSeeds(rng, startZ, endZ),
      borderLeft: generateBorderSeeds(rng, startZ, endZ, -CORRIDOR_WIDTH / 2 + 0.4, borderStyle),
      borderRight: generateBorderSeeds(rng, startZ, endZ, CORRIDOR_WIDTH / 2 - 0.4, borderStyle),
    });

    previousTier = tier;
    cursorZ = endZ;
  }

  // Финальная секция — спокойный подход к башне, без врагов
  const approachLength = 10;
  const approachStart = cursorZ;
  const approachEnd = approachStart + approachLength;
  const approachBorderStyle = pick(rng, BORDER_STYLES);
  const approachGate: GateSpec | null =
    previousTier !== null
      ? { id: "gate-approach", requiredSpells: gateRequiredSpells(previousTier, ALL_SPELLS.length) }
      : null;
  sections.push({
    index: sections.length,
    startZ: approachStart,
    endZ: approachEnd,
    length: approachLength,
    tier: 0,
    color: APPROACH_COLOR,
    borderStyle: approachBorderStyle,
    gateAtStart: approachGate,
    witches: [],
    bonfires: [],
    practiceTargets: [],
    grass: generateGrassSeeds(rng, approachStart, approachEnd),
    borderLeft: generateBorderSeeds(rng, approachStart, approachEnd, -CORRIDOR_WIDTH / 2 + 0.4, approachBorderStyle),
    borderRight: generateBorderSeeds(rng, approachStart, approachEnd, CORRIDOR_WIDTH / 2 - 0.4, approachBorderStyle),
  });
  cursorZ = approachEnd;

  return {
    sections,
    spawnPoint: { x: 0, y: 1, z: -2 },
    towerZ: cursorZ + 2,
    corridorWidth: CORRIDOR_WIDTH,
  };
}

/**
 * Ищет позицию для ведьмы в пределах секции, отстоящую минимум на
 * MIN_SPACING от уже размещённых точек (других ведьм и костра) — иначе они
 * могут оказаться почти друг на друге, и отступление от одной ведьмы тут же
 * упирается в другую (баг: "бой перезапускается мгновенно").
 */
const MIN_ENTITY_SPACING = 4.5;
function pickSpacedPosition(
  rng: () => number,
  startZ: number,
  endZ: number,
  placed: { x: number; z: number }[],
  minSpacing: number = MIN_ENTITY_SPACING
): { x: number; z: number } {
  const ATTEMPTS = 20;
  let best: { x: number; z: number } | null = null;
  let bestMinDist = -Infinity;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const candidate = { x: randRange(rng, -2.5, 2.5), z: randRange(rng, startZ + 2, endZ - 2) };
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
  // Не нашли идеальную позицию за ATTEMPTS попыток (секция тесная) —
  // берём лучшую из найденных, это всё равно лучше чистого рандома.
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

function generateGrassSeeds(rng: () => number, startZ: number, endZ: number): ScatterSeed[] {
  const density = 3.2; // тufтов на метр длины секции
  const count = Math.round((endZ - startZ) * density);
  const seeds: ScatterSeed[] = [];
  for (let i = 0; i < count; i++) {
    seeds.push({
      x: randRange(rng, -CORRIDOR_WIDTH / 2 + 0.6, CORRIDOR_WIDTH / 2 - 0.6),
      z: randRange(rng, startZ, endZ),
      rot: randRange(rng, 0, Math.PI * 2),
      scale: randRange(rng, 0.7, 1.3),
    });
  }
  return seeds;
}

function generateBorderSeeds(
  rng: () => number,
  startZ: number,
  endZ: number,
  x: number,
  style: BorderStyle
): ScatterSeed[] {
  const seeds: ScatterSeed[] = [];
  // Забор — регулярные столбы почти без пропусков; кусты/скалы — органичнее, с разбросом.
  const [gapMin, gapMax, jitter] = style === "fence" ? [1.6, 2.0, 0.1] : [2, 3.5, 0.25];
  let z = startZ + randRange(rng, 0.5, 2);
  while (z < endZ) {
    seeds.push({ x: x + randRange(rng, -jitter, jitter), z, rot: randRange(rng, 0, Math.PI * 2), scale: randRange(rng, 0.8, 1.3) });
    z += randRange(rng, gapMin, gapMax);
  }
  return seeds;
}
