/**
 * Идентификаторы окружений («биомов») мира — листовой модуль БЕЗ зависимостей.
 *
 * Биом — это внешний вид секции, а не её правила: пол, стены, декор и то, во что
 * превращаются кусты/деревья/бордюр. Игровая логика (ведьмы, сундуки, стелс,
 * ворота) от биома не зависит — поэтому генерация сидов одинакова для всех биомов,
 * а различается только материализация в SectionChunk.
 *
 * Лежит отдельно, чтобы данные заклинаний (data/spells.ts) могли проверять поле
 * `biome` у школы, не создавая цикла импортов с модулями мира.
 *
 * Чтобы добавить окружение: добавь id сюда, описание — в biomes.ts, а школе в
 * data/spells/schools.json допиши `"biome": "<id>"`.
 */
export const BIOME_IDS = ["meadow", "classroom", "steampunk"] as const;

export type BiomeId = (typeof BIOME_IDS)[number];

/** Окружение по умолчанию: поле с травой (всё, что школе не назначено явно). */
export const DEFAULT_BIOME: BiomeId = "meadow";

export function isBiomeId(value: unknown): value is BiomeId {
  return typeof value === "string" && (BIOME_IDS as readonly string[]).includes(value);
}
