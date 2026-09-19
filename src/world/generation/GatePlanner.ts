import { ALL_SPELLS, getSpellsBySchool } from "../../data/spells";
import type { GameState } from "../../core/GameState";
import type { SectionSpec } from "../spec/SectionSpec";
import type { RandomFn } from "../math/Rng";
import { FORK_GATE_FRACTION } from "./WorldGenConfig";

/**
 * Планировщик выходных ворот секции: уровень барьера (число тем) и тематика
 * (школа-ветка прокачки). Держит карту «сколько раз школа уже назначалась»
 * (анти-повтор внутри прогона) — она сериализуется, чтобы продление мира
 * продолжало раздавать неотработанные школы, а не начинало счёт заново.
 */
export class GatePlanner {
  private used = new Map<string, number>();

  constructor(
    private readonly rng: RandomFn,
    private readonly gameState: GameState
  ) {}

  /**
   * Уровень барьера: доля от ВСЕГО числа заклинаний, зависящая от сложности
   * секции (tier 1-3). С ростом контента (добавление школ) пороги масштабируются
   * сами — tier/6 от общего числа тем (1/6, 1/3, 1/2 для tier 1/2/3).
   */
  public static requiredSpells(tier: number, totalSpells: number): number {
    return Math.max(1, Math.min(totalSpells, Math.ceil((totalSpells * tier) / 6)));
  }

  public snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, count] of this.used) out[id] = count;
    return out;
  }

  public restore(usage: Record<string, number>): void {
    this.used = new Map(Object.entries(usage));
  }

  /**
   * Назначает выходные ворота секции: forceFork=true — принудительно развилка
   * (двое ворот). oneWay управляет ТОЛЬКО односторонним блоком за барьерами
   * развилки (см. EnergyGate) — сама раскладка (x=±w/4) не зависит от него.
   * У настоящей развилки oneWay=true; у развилки-тупика oneWay=false.
   */
  public assignExitGates(spec: SectionSpec, forceFork: boolean, oneWay: boolean = true): void {
    const fork = forceFork;
    const schools = this.pickSchools(fork ? 2 : 1);
    const required = GatePlanner.requiredSpells(spec.tier, ALL_SPELLS.length);

    if (fork) {
      const gateWidth = spec.width * FORK_GATE_FRACTION - 0.3;
      spec.gates = [
        { id: `gate-${spec.index}-a`, requiredSpells: required, schoolId: schools[0] ?? null, x: -spec.width / 4, width: gateWidth, fork: oneWay },
        { id: `gate-${spec.index}-b`, requiredSpells: required, schoolId: schools[1] ?? schools[0] ?? null, x: spec.width / 4, width: gateWidth, fork: oneWay },
      ];
    } else {
      spec.gates = [{ id: `gate-${spec.index}`, requiredSpells: required, schoolId: schools[0] ?? null, x: 0, width: spec.width - 0.4 }];
    }
  }

  /** Вход в подход к башне — одиночный барьер на последней боевой секции. */
  public assignApproachGate(prevSpec: SectionSpec): void {
    const schools = this.pickSchools(1);
    prevSpec.gates = [
      {
        id: "gate-approach",
        requiredSpells: GatePlanner.requiredSpells(prevSpec.tier, ALL_SPELLS.length),
        schoolId: schools[0] ?? null,
        x: 0,
        width: prevSpec.width - 0.4,
      },
    ];
  }

  /**
   * Выбор школ-тем для ворот. Тематика — ветки прокачки: чем меньше школа
   * отработана (суммарное мастерство её спеллов) и чем реже она уже назначалась
   * воротам в этом прогоне, тем выше шанс, что очередные ворота отправят игрока
   * именно в неё.
   */
  private pickSchools(count: 1 | 2): string[] {
    // Темой ворот может быть только школа с реальным контентом (спеллами):
    // пустая ветка не даст игроку отработать её у барьера.
    const schools = this.gameState.getUnlockedSchools().filter((s) => getSpellsBySchool(s.id).length > 0);
    const scored = schools
      .map((s) => {
        const practice = ALL_SPELLS.filter((sp) => sp.school === s.id).reduce((sum, sp) => sum + this.gameState.getMastery(sp.id), 0);
        const load = this.used.get(s.id) ?? 0;
        const weight = (1 / (1 + load * 2.5 + practice * 0.5)) * (0.8 + this.rng() * 0.4);
        return { id: s.id, weight };
      })
      .sort((a, b) => b.weight - a.weight);

    const chosen = scored.slice(0, count).map((s) => s.id);
    for (const id of chosen) this.used.set(id, (this.used.get(id) ?? 0) + 1);
    return chosen;
  }
}
