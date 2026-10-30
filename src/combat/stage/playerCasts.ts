import type { GestureId } from "../../core/playerGestures";
import type { StrikeKind } from "./strikeRecipes";

/**
 * Какими жестами игрок кастует заклинание каждого вида: каждый раз выбирается один из набора,
 * поэтому то одна рука, то обе, то замах над головой. Набор подобран по образу: камень бросают
 * сверху или двумя руками, молнию — сверху или пальцем, луч — указывают, шар — рисуют кругом.
 */
export const CAST_GESTURES: Readonly<Record<StrikeKind, readonly GestureId[]>> = {
  stone: ["castOverhead", "castBoth", "castRight"],
  steam: ["castBoth", "castCircle", "castLeft"],
  beam: ["castPoint", "castBoth", "castRight"],
  lightning: ["castOverhead", "castPoint", "castLeft"],
  orb: ["castCircle", "castRight", "castLeft", "castBoth"],
};

export function castGesturesFor(kind: StrikeKind): readonly GestureId[] {
  return CAST_GESTURES[kind];
}
