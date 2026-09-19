import { SectionContentBuilder } from "../../SectionContent";
import type { SectionSpec } from "../../spec/SectionSpec";
import { localToWorld, yawAt, clamp } from "../../geometry/SectionGeometry";
import { chance, randRange } from "../../math/Rng";
import {
  SIDE_SPUR_PROBABILITY,
  SIDE_SPUR_WIDTH,
  SIDE_SPUR_LENGTH,
  SIDE_SPUR_MARGIN,
} from "../WorldGenConfig";
import type { SectionAssemblyContext, SectionExtender } from "../SectionAssembler";

/**
 * Боковые перпендикулярные ниши-тупики (см. SideSpurSpec).
 *
 * Идёт ПОСЛЕ ContentExtender: ниша — самостоятельная надстройка поверх готового
 * spec, её проём вырезается из УЖЕ сгенерированного бордюра соответствующей
 * стороны (иначе кусты/забор/скалы торчали бы прямо в дверном проёме), а ведьма
 * и сундук подбираются отдельно (buildSideSpurContent).
 *
 * На какие секции НЕ ставится (проверки ДО первого rng-вызова, чтобы не сбивать
 * поток генератора — ветки/первая секция/подход нишу не получают вовсе):
 *  - первая секция (онбординг);
 *  - ветки развилки (forkBranch) — у них свой, более крупный механизм;
 *  - подход к башне (tier 0).
 */
export class SideSpurExtender implements SectionExtender {
  public readonly name = "side-spurs";

  constructor(private readonly builder: SectionContentBuilder) {}

  public extend(spec: SectionSpec, ctx: SectionAssemblyContext): void {
    if (spec.index === 0 || spec.forkBranch || spec.tier === 0) return;

    const rng = ctx.rng;
    if (!chance(rng, SIDE_SPUR_PROBABILITY)) return;
    if (spec.length <= SIDE_SPUR_MARGIN * 2 + 2) return;

    const doorZ = randRange(rng, SIDE_SPUR_MARGIN, spec.length - SIDE_SPUR_MARGIN);
    const side: "left" | "right" = rng() < 0.5 ? "left" : "right";
    // Нечем наградить (весь лор собран) или некому напасть (школы/темы
    // недоступны на этом tier) — ниша в этот раз не появляется.
    const content = this.builder.buildSideSpurContent(spec.tier);
    if (!content) return;

    const spurLength = randRange(rng, SIDE_SPUR_LENGTH.min, SIDE_SPUR_LENGTH.max);
    const half = SIDE_SPUR_WIDTH / 2;
    const doorX = side === "right" ? spec.width / 2 : -spec.width / 2;
    const doorWorld = localToWorld(spec, doorX, doorZ);
    // Курс ниши — курс родителя В ТОЧКЕ проёма, повёрнутый на ±90°: рукав
    // уходит СТРОГО ПЕРПЕНДИКУЛЯРНО коридору.
    const spurYaw = yawAt(spec, doorZ) + (side === "right" ? Math.PI / 2 : -Math.PI / 2);

    spec.sideSpurs.push({
      id: ctx.ids.nextSpur(),
      side,
      start: doorWorld,
      yaw: spurYaw,
      width: SIDE_SPUR_WIDTH,
      length: spurLength,
      doorZ,
      witch: {
        id: ctx.ids.nextWitch(),
        x: randRange(rng, -(half - 1), half - 1),
        z: clamp(spurLength * 0.4, 2, spurLength - 3),
        spellId: content.spellId,
      },
      chest: {
        id: ctx.ids.nextChest(),
        x: randRange(rng, -(half - 1), half - 1),
        z: spurLength - 1.6,
        bookIds: [content.book.bookId],
        pageIds: content.book.pageIds,
      },
    });

    // Проём режем из уже сгенерированного бордюра этой стороны.
    const gapMin = doorZ - half - 0.6;
    const gapMax = doorZ + half + 0.6;
    if (side === "left") {
      spec.borderLeft = spec.borderLeft.filter((s) => s.z < gapMin || s.z > gapMax);
    } else {
      spec.borderRight = spec.borderRight.filter((s) => s.z < gapMin || s.z > gapMax);
    }
  }
}
