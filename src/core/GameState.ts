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
import { Book, ChestLoot, booksRequiredFor, getBookById, getBookPageById, getPageBySpell } from "../data/books";

export interface SpellProgress {
  learned: boolean;
  mastery: number; // 0..MAX_MASTERY, растёт за успешные ответы в бою
}

export const MAX_MASTERY = 5;

/**
 * Сериализуемый снимок прогресса (для сохранений). Только данные: ни Map, ни Set.
 * Заклинания, книги и страницы — id из справочников (при загрузке неизвестные отбрасываются);
 * ведьмы, ворота и сундуки — id из сгенерированного мира (годятся только для того же мира).
 */
export interface GameStateSnapshot {
  learned: string[];
  /** Мастерство только у тех, у кого оно больше нуля. */
  mastery: Record<string, number>;
  defeatedWitchIds: string[];
  openedGateIds: string[];
  openedChestIds: string[];
  bookPageIds: string[];
  bookIds: string[];
  chestLoot: Record<string, ChestLoot>;
}

export interface RestoreOptions {
  /**
   * Восстанавливать ли прогресс, привязанный к конкретному миру (ведьмы, ворота, сундуки).
   * false — когда мир другой (например, изменился генератор): книги, страницы и заклинания
   * остаются, а id из старого мира не значат ничего.
   */
  world?: boolean;
}

export type GameStateListener = () => void;

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
  private readonly listeners = new Set<GameStateListener>();

  constructor() {
    this.resetProgress();
  }

  /** Подписка на любое реальное изменение прогресса (повторные вызовы с тем же результатом не считаются). */
  public subscribe(listener: GameStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of [...this.listeners]) l();
  }

  /** Добавляет id в множество; сообщает подписчикам только если он там появился впервые. */
  private addTo(set: Set<string>, id: string): void {
    if (set.has(id)) return;
    set.add(id);
    this.notify();
  }

  private resetProgress(): void {
    this.progress.clear();
    for (const spell of ALL_SPELLS) {
      this.progress.set(spell.id, { learned: false, mastery: 0 });
    }
    for (const id of STARTER_SPELL_IDS) {
      const entry = this.progress.get(id);
      if (entry) entry.learned = true;
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
    this.addTo(this.defeatedWitchIds, witchId);
  }

  public isWitchDefeated(witchId: string): boolean {
    return this.defeatedWitchIds.has(witchId);
  }

  public openGate(gateId: string): void {
    this.addTo(this.openedGateIds, gateId);
  }

  public isGateOpen(gateId: string): boolean {
    return this.openedGateIds.has(gateId);
  }

  public openChest(chestId: string): void {
    this.addTo(this.openedChestIds, chestId);
  }

  public isChestOpen(chestId: string): boolean {
    return this.openedChestIds.has(chestId);
  }

  public collectBookPage(pageId: string): void {
    this.addTo(this.collectedBookPageIds, pageId);
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
    this.addTo(this.collectedBookIds, bookId);
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
    this.addTo(this.openedChestIds, chestId);
    this.chestLoot.set(chestId, { bookIds: [...loot.bookIds], pageIds: [...loot.pageIds] });
    for (const id of loot.bookIds) this.collectBook(id);
    for (const id of loot.pageIds) this.collectBookPage(id);
    this.notify(); // содержимое сундука тоже часть прогресса, даже если сам сундук уже был помечен открытым
  }

  public getChestLoot(chestId: string): ChestLoot | undefined {
    const loot = this.chestLoot.get(chestId);
    return loot ? { bookIds: [...loot.bookIds], pageIds: [...loot.pageIds] } : undefined;
  }

  public learn(spellId: string): void {
    const entry = this.progress.get(spellId);
    if (!entry || entry.learned) return;
    entry.learned = true;
    this.notify();
  }

  public addMastery(spellId: string, amount = 1): void {
    const entry = this.progress.get(spellId);
    if (!entry || !entry.learned) return;
    const next = Math.min(MAX_MASTERY, entry.mastery + amount);
    if (next === entry.mastery) return;
    entry.mastery = next;
    this.notify();
  }

  // ---------- Сохранение и загрузка ----------

  public snapshot(): GameStateSnapshot {
    const mastery: Record<string, number> = {};
    const learned: string[] = [];
    for (const [id, entry] of this.progress) {
      if (entry.learned) learned.push(id);
      if (entry.mastery > 0) mastery[id] = entry.mastery;
    }
    const chestLoot: Record<string, ChestLoot> = {};
    for (const [id, loot] of this.chestLoot) chestLoot[id] = { bookIds: [...loot.bookIds], pageIds: [...loot.pageIds] };
    return {
      learned,
      mastery,
      defeatedWitchIds: [...this.defeatedWitchIds],
      openedGateIds: [...this.openedGateIds],
      openedChestIds: [...this.openedChestIds],
      bookPageIds: [...this.collectedBookPageIds],
      bookIds: [...this.collectedBookIds],
      chestLoot,
    };
  }

  /**
   * Заменяет прогресс данными из снимка. Снимок мог быть записан другой версией игры, поэтому
   * неизвестные заклинания, книги и страницы отбрасываются (иначе UI споткнётся о id без записи
   * в справочнике), а мастерство ограничивается 0…MAX_MASTERY и только у изученных.
   * Стартовые заклинания изучены всегда.
   */
  public restore(snapshot: GameStateSnapshot, options: RestoreOptions = {}): void {
    const withWorld = options.world !== false;
    this.resetProgress();
    for (const id of snapshot.learned) {
      const entry = this.progress.get(id);
      if (entry) entry.learned = true;
    }
    for (const [id, value] of Object.entries(snapshot.mastery)) {
      const entry = this.progress.get(id);
      if (entry?.learned && Number.isFinite(value)) entry.mastery = Math.max(0, Math.min(MAX_MASTERY, Math.round(value)));
    }

    const knownBooks = (ids: string[]): string[] => ids.filter((id) => getBookById(id) !== undefined);
    const knownPages = (ids: string[]): string[] => ids.filter((id) => getBookPageById(id) !== undefined);
    this.collectedBookIds = new Set(knownBooks(snapshot.bookIds));
    this.collectedBookPageIds = new Set(knownPages(snapshot.bookPageIds));

    this.defeatedWitchIds = new Set(withWorld ? snapshot.defeatedWitchIds : []);
    this.openedGateIds = new Set(withWorld ? snapshot.openedGateIds : []);
    this.openedChestIds = new Set(withWorld ? snapshot.openedChestIds : []);
    this.chestLoot = new Map();
    if (withWorld) {
      for (const [id, loot] of Object.entries(snapshot.chestLoot)) {
        this.chestLoot.set(id, { bookIds: knownBooks(loot.bookIds), pageIds: knownPages(loot.pageIds) });
      }
    }
    this.notify();
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