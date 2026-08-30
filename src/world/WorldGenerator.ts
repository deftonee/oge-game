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

export interface SectionSpec {
  index: number;
  startZ: number;
  endZ: number;
  length: number;
  tier: number; // 1-3 сложность; 0 — служебная секция подхода к башне, без врагов
  color: string;
  witches: WitchSpec[];
  bonfires: BonfireSpec[];
  grass: ScatterSeed[];
  bushesLeft: ScatterSeed[];
  bushesRight: ScatterSeed[];
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

  for (let i = 0; i < sectionCount; i++) {
    const tier = Math.min(3, Math.floor((i / sectionCount) * 3) + 1);
    const length = randRange(rng, 12, 18);
    const startZ = cursorZ;
    const endZ = startZ + length;

    const spellPool = ALL_SPELLS.filter((s) => s.tier <= tier);
    const witchCount = randInt(rng, 1, tier === 1 ? 2 : 3);
    const witches: WitchSpec[] = [];
    for (let w = 0; w < witchCount; w++) {
      const spell = pickWeightedByWeakness(rng, spellPool, gameState);
      witches.push({
        id: `witch-${witchCounter++}`,
        x: randRange(rng, -2.5, 2.5),
        z: randRange(rng, startZ + 2, endZ - 2),
        spellId: spell.id,
      });
    }

    const bonfires: BonfireSpec[] = [{ id: `bonfire-${i}`, x: randRange(rng, -1.5, 1.5), z: startZ + 2.5 }];

    sections.push({
      index: i,
      startZ,
      endZ,
      length,
      tier,
      color: TIER_COLORS[tier] ?? TIER_COLORS[3],
      witches,
      bonfires,
      grass: generateGrassSeeds(rng, startZ, endZ),
      bushesLeft: generateBushSeeds(rng, startZ, endZ, -CORRIDOR_WIDTH / 2 + 0.4),
      bushesRight: generateBushSeeds(rng, startZ, endZ, CORRIDOR_WIDTH / 2 - 0.4),
    });

    cursorZ = endZ;
  }

  // Финальная секция — спокойный подход к башне, без врагов
  const approachLength = 10;
  const approachStart = cursorZ;
  const approachEnd = approachStart + approachLength;
  sections.push({
    index: sections.length,
    startZ: approachStart,
    endZ: approachEnd,
    length: approachLength,
    tier: 0,
    color: APPROACH_COLOR,
    witches: [],
    bonfires: [],
    grass: generateGrassSeeds(rng, approachStart, approachEnd),
    bushesLeft: generateBushSeeds(rng, approachStart, approachEnd, -CORRIDOR_WIDTH / 2 + 0.4),
    bushesRight: generateBushSeeds(rng, approachStart, approachEnd, CORRIDOR_WIDTH / 2 - 0.4),
  });
  cursorZ = approachEnd;

  return {
    sections,
    spawnPoint: { x: 0, y: 1, z: -2 },
    towerZ: cursorZ + 2,
    corridorWidth: CORRIDOR_WIDTH,
  };
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

function generateBushSeeds(rng: () => number, startZ: number, endZ: number, x: number): ScatterSeed[] {
  const seeds: ScatterSeed[] = [];
  let z = startZ + randRange(rng, 0.5, 2);
  while (z < endZ) {
    seeds.push({ x: x + randRange(rng, -0.25, 0.25), z, rot: randRange(rng, 0, Math.PI * 2), scale: randRange(rng, 0.8, 1.3) });
    z += randRange(rng, 2, 3.5);
  }
  return seeds;
}
