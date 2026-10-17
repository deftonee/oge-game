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
import { Book, ChestLoot, booksRequiredFor, getPageBySpell } from "../data/books";

export interface SpellProgress {
  learned: boolean;
  mastery: number; // 0..MAX_MASTERY, растёт за успешные ответы в бою
}

export const MAX_MASTERY = 5;

/**
 * Центральное состояние прокачки игрока. Ветки (школы) независимы: у каждой
 * свой граф внутри и свой прогресс; школа открывается правилом из data
 * (по умолчанию всегда; Школа тайн — после N изученных мостов).
 *
 * Изучение заклинания требует материалов, найденных в сундуках: книгу школы
 * (ветки прокачки) и страницу самого заклинания — см. canLearn().
 */
export class GameState {
  private progress = new Map<string, SpellProgress>();
  private defeatedWitchIds = new Set<string>();
  private openedGateIds = new Set<string>();
  private openedChestIds = new Set<string>();
  private collectedBookPageIds = new Set<string>();
  private collectedBookIds = new Set<string>();
  /** Что именно лежало в открытом сундуке (содержимое динамических сундуков определяется при открытии). */
  private chestLoot = new Map<string, ChestLoot>();

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

  // ---------- Книги и содержимое сундуков ----------

  public collectBook(bookId: string): void {
    this.collectedBookIds.add(bookId);
  }

  public hasBook(bookId: string): boolean {
    return this.collectedBookIds.has(bookId);
  }

  public getCollectedBookIds(): string[] {
    return [...this.collectedBookIds];
  }

  /**
   * Фиксирует открытие сундука: запоминает содержимое (чтобы повторный осмотр и
   * пересборка секции показали то же самое) и переносит книги/страницы в
   * коллекцию игрока. Повторный вызов для того же сундука безопасен.
   */
  public recordChestLoot(chestId: string, loot: ChestLoot): void {
    this.openedChestIds.add(chestId);
    this.chestLoot.set(chestId, { bookIds: [...loot.bookIds], pageIds: [...loot.pageIds] });
    for (const id of loot.bookIds) this.collectBook(id);
    for (const id of loot.pageIds) this.collectBookPage(id);
  }

  public getChestLoot(chestId: string): ChestLoot | undefined {
    const loot = this.chestLoot.get(chestId);
    return loot ? { bookIds: [...loot.bookIds], pageIds: [...loot.pageIds] } : undefined;
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

  // ---------- Материалы для изучения (книги и страницы) ----------

  /** Книги школ заклинания, которых у игрока ещё нет. */
  public missingBooks(spell: Spell): Book[] {
    return booksRequiredFor(spell).filter((b) => !this.hasBook(b.id));
  }

  /** Найдена ли страница заклинания. */
  public hasSpellPage(spell: Spell): boolean {
    const page = getPageBySpell(spell.id);
    return !!page && this.hasBookPage(page.id);
  }

  /** Есть и все нужные книги, и страница заклинания. */
  public hasMaterials(spell: Spell): boolean {
    return this.missingBooks(spell).length === 0 && this.hasSpellPage(spell);
  }

  /**
   * Можно ли изучить заклинание у костра ПРЯМО СЕЙЧАС: тема доступна по дереву
   * (школа открыта, пререквизиты изучены — isUnlockable) и найдены материалы.
   */
  public canLearn(spell: Spell): boolean {
    return this.isUnlockable(spell) && this.hasMaterials(spell);
  }
}