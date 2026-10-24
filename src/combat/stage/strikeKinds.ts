import type { Spell } from "../../data/spells";
import type { StrikeKind } from "./strikeRecipes";

/** Вид анимации по школе: механика — камень, термодинамика — горячий пар, оптика — луч, электричество — молния, квант — сфера. */
const KIND_BY_SCHOOL: Readonly<Record<string, StrikeKind>> = {
  earth: "stone",
  fire: "steam",
  light: "beam",
  storm: "lightning",
  secrets: "orb",
};

/**
 * Вид анимации для отдельных заклинаний — перекрывает школу. Сейчас пусто: у всех заклинаний школы
 * один образ, но когда у каждого появится свой, достаточно дописать строку «id заклинания → вид».
 */
const KIND_BY_SPELL: Readonly<Record<string, StrikeKind>> = {};

/** Запасной вид для школ, которым образ ещё не назначен. */
export const DEFAULT_STRIKE_KIND: StrikeKind = "orb";

/** Какая анимация у удара этим заклинанием: сначала заклинание, потом школа, потом запасной вариант. */
export function strikeKindFor(spell: Pick<Spell, "id" | "school">): StrikeKind {
  return KIND_BY_SPELL[spell.id] ?? KIND_BY_SCHOOL[spell.school] ?? DEFAULT_STRIKE_KIND;
}
