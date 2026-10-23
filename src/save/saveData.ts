import type { GameStateSnapshot } from "../core/GameState";

/**
 * Формат сохранения. Версия лежит и в ключе localStorage (см. SAVE_KEY), и в самих данных:
 * при несовместимой смене формата поднимаем обе — старое сохранение просто не подхватится.
 *
 * Мир не хранится: он целиком определяется seed (генерация детерминирована), поэтому в сохранении
 * только seed и «подпись» мира (см. worldSignature) — по ней при загрузке понятно, что генератор
 * с тех пор не менялся и позиция игрока и id ведьм/сундуков по-прежнему что-то значат.
 *
 * Ограничение: если когда-нибудь игра начнёт продлевать мир (extendWorld) во время прохождения,
 * в сохранение придётся добавить число продлений и повторять их при загрузке.
 */
export const SAVE_VERSION = 1;

export interface SavedWorld {
  seed: number;
  signature: string;
}

export interface SavedPlayer {
  x: number;
  z: number;
}

export interface GameSave {
  version: typeof SAVE_VERSION;
  savedAt: number;
  world: SavedWorld;
  progress: GameStateSnapshot;
  player: SavedPlayer;
}

// Потолки защищают от раздутых/подделанных данных в localStorage.
const MAX_LIST = 5000;
const MAX_ID_LENGTH = 120;
const MAX_SIGNATURE_LENGTH = 64;
const MAX_COORD = 1_000_000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFinite_ = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Записи с произвольными ключами — без прототипа, чтобы ключ вроде «__proto__» был обычным ключом. */
function dictionary<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** Список id: отсутствует → пустой (сохранения старых версий), не массив → null (данные испорчены), мусор внутри отбрасывается. */
function idList(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  return value.slice(0, MAX_LIST).filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= MAX_ID_LENGTH);
}

function parseProgress(value: unknown): GameStateSnapshot | null {
  if (!isRecord(value)) return null;
  const learned = idList(value.learned);
  const defeatedWitchIds = idList(value.defeatedWitchIds);
  const openedGateIds = idList(value.openedGateIds);
  const openedChestIds = idList(value.openedChestIds);
  const bookPageIds = idList(value.bookPageIds);
  const bookIds = idList(value.bookIds);
  if (!learned || !defeatedWitchIds || !openedGateIds || !openedChestIds || !bookPageIds || !bookIds) return null;

  const mastery = dictionary<number>();
  if (value.mastery !== undefined) {
    if (!isRecord(value.mastery)) return null;
    for (const [id, m] of Object.entries(value.mastery).slice(0, MAX_LIST)) {
      if (id.length <= MAX_ID_LENGTH && isFinite_(m)) mastery[id] = m;
    }
  }

  const chestLoot = dictionary<{ bookIds: string[]; pageIds: string[] }>();
  if (value.chestLoot !== undefined) {
    if (!isRecord(value.chestLoot)) return null;
    for (const [id, loot] of Object.entries(value.chestLoot).slice(0, MAX_LIST)) {
      if (id.length > MAX_ID_LENGTH || !isRecord(loot)) continue;
      const books = idList(loot.bookIds);
      const pages = idList(loot.pageIds);
      if (books && pages) chestLoot[id] = { bookIds: books, pageIds: pages };
    }
  }

  return { learned, mastery, defeatedWitchIds, openedGateIds, openedChestIds, bookPageIds, bookIds, chestLoot };
}

/**
 * Разбирает и проверяет данные из хранилища. Возвращает новый объект (не ссылку на сырые данные)
 * или null, если это не сохранение этой версии или оно испорчено. Никогда не бросает.
 */
export function parseSave(raw: unknown): GameSave | null {
  if (!isRecord(raw) || raw.version !== SAVE_VERSION) return null;
  if (!isFinite_(raw.savedAt)) return null;

  const world = raw.world;
  if (!isRecord(world) || !isFinite_(world.seed)) return null;
  if (typeof world.signature !== "string" || world.signature.length === 0 || world.signature.length > MAX_SIGNATURE_LENGTH) return null;

  const player = raw.player;
  if (!isRecord(player) || !isFinite_(player.x) || !isFinite_(player.z)) return null;
  if (Math.abs(player.x) > MAX_COORD || Math.abs(player.z) > MAX_COORD) return null;

  const progress = parseProgress(raw.progress);
  if (!progress) return null;

  return {
    version: SAVE_VERSION,
    savedAt: raw.savedAt,
    world: { seed: world.seed, signature: world.signature },
    progress,
    player: { x: player.x, z: player.z },
  };
}
