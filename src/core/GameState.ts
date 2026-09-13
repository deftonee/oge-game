import {
  ALL_SPELLS,
  ALL_SCHOOLS,
  Spell,
  School,
  STARTER_SPELL_IDS,
  getSchoolById,
  getSpellsBySchool,
  isBridgeSpell,
} from "../data/spells";

export interface SpellProgress {
  learned: boolean;
  mastery: number; // 0..MAX_MASTERY, растёт за успешные ответы в бою
}

export const MAX_MASTERY = 5;

/**
 * Центральное состояние прокачки игрока. Ветки (школы) независимы: у каждой
 * свой граф внутри и свой прогресс; школа открывается правилом из data
 * (по умолчанию всегда; Школа тайн — после N изученных мостов).
 */
export class GameState {
  private progress = new Map<string, SpellProgress>();
  private defeatedWitchIds = new Set<string>();
  private openedGateIds = new Set<string>();
  private openedChestIds = new Set<string>();
  private collectedBookPageIds = new Set<string>();

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

  public openChest(chestId: string): void {
    this.openedChestIds.add(chestId);
  }

  public isChestOpen(chestId: string): boolean {
    return this.openedChestIds.has(chestId);
  }

  public collectBookPage(pageId: string): void {
    this.collectedBookPageIds.add(pageId);
  }

  public hasBookPage(pageId: string): boolean {
    return this.collectedBookPageIds.has(pageId);
  }

  public getCollectedBookPageIds(): string[] {
    return [...this.collectedBookPageIds];
  }

  public getOpenedChestIds(): string[] {
    return [...this.openedChestIds];
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

  // ---------- Школы (ветки) ----------

  /** Сколько мостов (комбо-заклинаний двух школ) игрок успел изучить. */
  public getLearnedBridgeCount(): number {
    return ALL_SPELLS.filter((s) => isBridgeSpell(s) && this.isLearned(s.id)).length;
  }

  /** Школа открыта? По умолчанию да; у школы с unlockRule — после N мостов. */
  public isSchoolUnlocked(schoolId: string): boolean {
    const school = getSchoolById(schoolId);
    const required = school.unlockRule?.bridges ?? 0;
    if (required <= 0) return true;
    return this.getLearnedBridgeCount() >= required;
  }

  public getUnlockedSchools(): School[] {
    return ALL_SCHOOLS.filter((s) => this.isSchoolUnlocked(s.id));
  }

  /** Прогресс ветки: изучено/всего по ОСНОВНОЙ школе (мосты в свою основную). */
  public getSchoolProgress(schoolId: string): { learned: number; total: number } {
    const spells = getSpellsBySchool(schoolId);
    const learned = spells.filter((s) => this.isLearned(s.id)).length;
    return { learned, total: spells.length };
  }

  /** Пререквизиты изучены и школа открыта — тему можно выучить у костра. */
  public isUnlockable(spell: Spell): boolean {
    if (this.isLearned(spell.id)) return false;
    if (!this.isSchoolUnlocked(spell.school)) return false;
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