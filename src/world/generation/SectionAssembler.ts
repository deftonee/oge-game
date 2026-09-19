import type { SectionSpec } from "../spec/SectionSpec";
import type { IdCounters } from "../spec/WorldSpec";
import type { GameState } from "../../core/GameState";
import type { RandomFn } from "../math/Rng";

/**
 * Генератор id сущностей мира. Счётчики ГЛОБАЛЬНЫ в пределах одного мира, но не
 * между мирами (пересоздаются на каждый generateWorld) — так ветки развилки,
 * делящие index, всё равно не дают дублей id (см. тесты).
 */
export class IdFactory {
  private witch = 0;
  private chest = 0;
  private spur = 0;

  public nextWitch(): string {
    return `witch-${this.witch++}`;
  }

  public nextChest(): string {
    return `chest-${this.chest++}`;
  }

  public nextSpur(): string {
    return `spur-${this.spur++}`;
  }

  public snapshot(): IdCounters {
    return { witch: this.witch, chest: this.chest, spur: this.spur };
  }

  public static fromSnapshot(counters: IdCounters): IdFactory {
    const ids = new IdFactory();
    ids.witch = counters.witch;
    ids.chest = counters.chest;
    ids.spur = counters.spur;
    return ids;
  }
}

/** Контекст, разделяемый всеми расширениями при сборке одной секции. */
export interface SectionAssemblyContext {
  /** Общий rng-поток генератора (порядок вызовов критичен для детерминизма). */
  rng: RandomFn;
  gameState: GameState;
  ids: IdFactory;
  /** Секция спавна (узкий вход) — часть расширений на неё не ставится. */
  isFirst: boolean;
}

/**
 * Расширение секции: добавляет в spec один ОДНОРОДНЫЙ пласт объектов/декора.
 * Мелкие классы вместо одной простыни — так порядок и состав наполнения секции
 * задаётся явно и расширяется без правки генератора.
 */
export interface SectionExtender {
  readonly name: string;
  extend(spec: SectionSpec, ctx: SectionAssemblyContext): void;
}

/**
 * Упорядоченный конвейер расширений секции.
 *
 * Порядок регистрации = порядок применения и ДОЛЖЕН быть стабильным: часть
 * расширений зависит от уже готового spec (например, ниша вырезает проём в
 * УЖЕ сгенерированном бордюре — значит идёт после генератора декора). Это и
 * есть «упорядоченный, расширяемый механизм добавления объектов»: новое
 * наполнение (рельеф, сокровища, ловушки, точки интереса) добавляется как
 * отдельный SectionExtender через use(...), без изменения генератора трассы.
 */
export class SectionAssembler {
  private readonly extenders: SectionExtender[] = [];

  /** Зарегистрировать расширение (в порядке применения). */
  public use(extender: SectionExtender): this {
    this.extenders.push(extender);
    return this;
  }

  /** Применить все расширения к секции по порядку. */
  public assemble(spec: SectionSpec, ctx: SectionAssemblyContext): void {
    for (const extender of this.extenders) extender.extend(spec, ctx);
  }

  /** Имена расширений в порядке применения (диагностика/тесты). */
  public get pipeline(): readonly string[] {
    return this.extenders.map((e) => e.name);
  }
}
