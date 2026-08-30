import { ALL_SPELLS, Spell, STARTER_SPELL_IDS } from "../data/spells";

export interface SpellProgress {
  learned: boolean;
  mastery: number; // 0..MAX_MASTERY, растёт за успешные ответы в бою
}

export const MAX_MASTERY = 5;

/**
 * Центральное состояние прокачки игрока (п.2-3 ТЗ). Пока живёт в памяти —
 * сохранение в localStorage добавится вместе с этапом 10.
 */
export class GameState {
  private progress = new Map<string, SpellProgress>();
  private defeatedWitchIds = new Set<string>();
  private openedGateIds = new Set<string>();

  constructor() {
    for (const spell of ALL_SPELLS) {
      this.progress.set(spell.id, { learned: false, mastery: 0 });
    }
    for (const id of STARTER_SPELL_IDS) {
      this.learn(id);
    }
  }

  public isLearned(spellId: string): boolean {
    return this.progress.get(spellId)?.learned ?? false;
  }

  public getMastery(spellId: string): number {
    return this.progress.get(spellId)?.mastery ?? 0;
  }

  /** Изученные заклинания игрока — используется в бою, чтобы выбрать, чем атаковать. */
  public getLearnedSpells(excludeId?: string): Spell[] {
    return ALL_SPELLS.filter((s) => this.isLearned(s.id) && s.id !== excludeId);
  }

  public markWitchDefeated(witchId: string): void {
    this.defeatedWitchIds.add(witchId);
  }

  public isWitchDefeated(witchId: string): boolean {
    return this.defeatedWitchIds.has(witchId);
  }

  public openGate(gateId: string): void {
    this.openedGateIds.add(gateId);
  }

  public isGateOpen(gateId: string): boolean {
    return this.openedGateIds.has(gateId);
  }

  public learn(spellId: string): void {
    const entry = this.progress.get(spellId);
    if (entry) entry.learned = true;
  }

  public addMastery(spellId: string, amount = 1): void {
    const entry = this.progress.get(spellId);
    if (entry && entry.learned) {
      entry.mastery = Math.min(MAX_MASTERY, entry.mastery + amount);
    }
  }

  /** Пререквизиты изучены — тему можно открыть у костра. */
  public isUnlockable(spell: Spell): boolean {
    if (this.isLearned(spell.id)) return false;
    return spell.prerequisites.every((id) => this.isLearned(id));
  }

  /** Заклинания, которых игроку не хватает, чтобы открыть это. */
  public missingPrerequisites(spell: Spell): Spell[] {
    return spell.prerequisites
      .filter((id) => !this.isLearned(id))
      .map((id) => ALL_SPELLS.find((s) => s.id === id)!)
      .filter(Boolean);
  }
}
