import type { SectionSpec } from "../spec/SectionSpec";
import type { Vec2 } from "../geometry/SectionGeometry";
import { pick, type RandomFn } from "../math/Rng";
import { BORDER_STYLES, TIER_COLORS } from "./WorldGenConfig";

/**
 * Фабрика «базовой» секции: собирает SectionSpec с пустыми массивами сущностей
 * и корректными швами (prev/prev2). Наполнение сущностями — не её забота (см.
 * SectionAssembler). Единственный rng-вызов здесь — выбор стиля бордюра, ровно
 * как в исходном makeSection (порядок rng критичен для детерминизма мира).
 *
 * Порядок ключей в возвращаемом объекте менять нельзя: он влияет на
 * JSON.stringify(spec) (тесты сравнивают миры по seed).
 */
export class SectionFactory {
  constructor(private readonly rng: RandomFn) {}

  public create(
    index: number,
    tier: number,
    width: number,
    length: number,
    start: Vec2,
    end: Vec2,
    sectionYaw: number,
    curvature: number,
    prev: SectionSpec | null,
    prev2: SectionSpec | null = null
  ): SectionSpec {
    return {
      index,
      tier,
      color: TIER_COLORS[tier] ?? TIER_COLORS[3],
      borderStyle: pick(this.rng, BORDER_STYLES),
      length,
      width,
      start,
      end,
      yaw: sectionYaw,
      curvature,
      gates: [],
      partitionDepth: 0,
      prevWidth: prev ? prev.width : 0,
      prevEnd: prev ? { x: prev.end.x, z: prev.end.z } : { x: 0, z: 0 },
      prevWidth2: prev2 ? prev2.width : 0,
      prevEnd2: prev2 ? { x: prev2.end.x, z: prev2.end.z } : { x: 0, z: 0 },
      witches: [],
      bonfires: [],
      practiceTargets: [],
      chests: [],
      sideSpurs: [],
      grass: [],
      bushes: [],
      borderLeft: [],
      borderRight: [],
    };
  }
}
