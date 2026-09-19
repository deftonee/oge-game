import { SectionContentBuilder, type SectionContentRule } from "../../SectionContent";
import type { SectionSpec } from "../../spec/SectionSpec";
import type { SectionAssemblyContext, SectionExtender } from "../SectionAssembler";

/**
 * Базовый пласт содержимого секции: костры, ведьмы, цели, сундуки и весь декор
 * (трава/кусты/бордюры) через SectionContentBuilder. Для первых секций —
 * рукописное интро-правило (introRules по index), для остальных — процедурное
 * правило из состояния игры (что игроку нужно в следующей секции).
 *
 * Должен идти ПЕРВЫМ в конвейере: дальнейшие расширения (ниши) зависят от уже
 * сгенерированного декора/сущностей.
 */
export class ContentExtender implements SectionExtender {
  public readonly name = "content";

  constructor(
    private readonly builder: SectionContentBuilder,
    private readonly introRules: readonly SectionContentRule[]
  ) {}

  public extend(spec: SectionSpec, ctx: SectionAssemblyContext): void {
    const intro = this.introRules[spec.index];
    this.builder.apply(spec, intro ?? SectionContentBuilder.defaultRule(ctx.gameState, { tier: spec.tier, isFirst: ctx.isFirst }));
  }
}
