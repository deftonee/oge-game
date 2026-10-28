import { getSchoolById } from "../../data/spells";
import { TIER_COLORS } from "../generation/WorldGenConfig";
import type { GateSpec, PracticeTargetKind, SectionSpec } from "../spec/SectionSpec";
import { DEFAULT_BIOME, type BiomeId } from "./biomeIds";

export { BIOME_IDS, DEFAULT_BIOME, isBiomeId, type BiomeId } from "./biomeIds";

/**
 * Окружения мира — таблица ОПИСАНИЙ (данные) и два правила назначения.
 *
 * Как биом попадает в секцию. Каждая школа может объявить `biome` в
 * data/spells/schools.json. Энергетические ворота несут школу — «ветку, к
 * которой они ведут» (см. GateSpec.schoolId). Поэтому секция получает окружение
 * школы ТЕХ ворот, через которые в неё входят: прошёл барьер грозы — оказался в
 * школьном классе. Ворота работают как портал между окружениями.
 *
 *  - обычная секция      → биом ворот предыдущей секции (нет ворот — тот же, что был);
 *  - ветка развилки      → биом ЕЁ ворот (выбор ворот = выбор окружения);
 *  - схождение веток (J) → общий биом веток, если он один у обеих, иначе поле;
 *  - первая секция и подход к башне — всегда поле (мягкий вход / двор перед башней).
 *
 * Назначение НЕ тратит ни одного rng-вызова: порядок генерации и сиды не меняются.
 */

export interface BiomeDef {
  id: BiomeId;
  /** Цвет пола секции по сложности (tier 1–3). */
  floorColors: Readonly<Record<number, string>>;
  /** Цвет стен по границе пола. */
  wallColor: string;
  /** Высота стен, м. */
  wallHeight: number;
  /** Растёт ли трава (иначе пол чистый, а декор — на совести биома). */
  grass: boolean;
  /** Чем заменить деревца/крапиву для тренировки (по умолчанию — как в spec). */
  practiceKind?: PracticeTargetKind;
}

export const BIOMES: Readonly<Record<BiomeId, BiomeDef>> = {
  meadow: {
    id: "meadow",
    floorColors: TIER_COLORS,
    wallColor: "#4a4d52",
    wallHeight: 2.5,
    grass: true,
  },
  classroom: {
    id: "classroom",
    // Паркет: чем сложнее секция, тем темнее и «старше» доски.
    floorColors: { 1: "#c0a982", 2: "#ae9873", 3: "#9a8566" },
    wallColor: "#e6dcbc",
    // Чуть выше поля (2.5), но не намного: камера орбитальная, и высокая стена чаще закрывает обзор.
    wallHeight: 2.7,
    grass: false,
    practiceKind: "dummy",
  },
  steampunk: {
    id: "steampunk",
    // Клёпаные стальные плиты с бронзовым отливом: чем сложнее секция, тем темнее и «закопчённее».
    floorColors: { 1: "#a69078", 2: "#8b7762", 3: "#6f5f50" },
    // Тёмный кирпич котельной.
    wallColor: "#4b3a33",
    // Чуть выше класса (2.7): над машинами висят трубы и иллюминаторы, но камера по-прежнему орбитальная.
    wallHeight: 2.8,
    grass: false,
    practiceKind: "dummy",
  },
};

export function getBiome(id: BiomeId): BiomeDef {
  return BIOMES[id];
}

export function floorColorOf(biome: BiomeId, tier: number): string {
  const colors = BIOMES[biome].floorColors;
  return colors[tier] ?? colors[3] ?? TIER_COLORS[3];
}

/** Окружение школы (не задано в schools.json — поле). Ворота без школы — тоже поле. */
export function biomeOfSchool(schoolId: string | null | undefined): BiomeId {
  if (!schoolId) return DEFAULT_BIOME;
  return getSchoolById(schoolId).biome ?? DEFAULT_BIOME;
}

/** Окружение, в которое ведут ворота; у секции без ворот — `fallback` (что было, то и осталось). */
export function biomeBeyondGate(gate: Pick<GateSpec, "schoolId"> | undefined, fallback: BiomeId): BiomeId {
  return gate ? biomeOfSchool(gate.schoolId) : fallback;
}

/** Назначает секции окружение: биом и пол соответствующего цвета (стены/декор берёт SectionChunk по spec.biome). */
export function applyBiome(spec: SectionSpec, biome: BiomeId): void {
  spec.biome = biome;
  spec.color = floorColorOf(biome, spec.tier);
}
