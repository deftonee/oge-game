/**
 * Профиль качества графики: один источник правды для всех «косметических»
 * настроек, которые стоит урезать на слабых устройствах (густота травы,
 * детализация листвы, число искр в презентации находок).
 *
 * Игровая логика и данные мира (сиды в SectionSpec, коллайдеры, радиусы
 * укрытий) от профиля НЕ зависят — иначе мир и стелс вели бы себя по-разному
 * на разных устройствах. Профиль влияет только на то, во сколько геометрии
 * материализуется один и тот же сид.
 *
 * Явный выбор, по убыванию приоритета: `?quality=low|mid|high` в адресе (удобно
 * сравнивать на одном устройстве), затем настройка игрока (меню паузы → Графика),
 * затем автоопределение. Уровень читается один раз при запуске — геометрия
 * строится под него, поэтому смена в меню применяется при следующем запуске.
 */

import { loadSettings } from "../settings/settingsStorage";

export type QualityTier = "low" | "mid" | "high";

export interface QualityProfile {
  tier: QualityTier;
  /** Пучков травы на один сид из spec (сидов в spec ≈ 2 на м²). */
  grassTuftsPerSeed: number;
  /** Травинок в одном пучке (по 3 треугольника на травинку). */
  grassBladesPerTuft: number;
  /** Детализация одного комка листвы: subdivisions ico-сферы (1 → 20 граней, 2 → 80). */
  foliageDetail: 1 | 2;
  /** Комков листвы в одном кусте/зарослях. */
  bushBlobs: number;
  /** Комков листвы в кроне дерева. */
  canopyBlobs: number;
  /** Искр в презентации находок (0 — без искр). */
  sparkCount: number;
  /** Масштаб канваса искр относительно экрана (искры мягкие — разрешение им не нужно). */
  sparkResolutionScale: number;
}

export const QUALITY_PROFILES: Readonly<Record<QualityTier, QualityProfile>> = {
  low: {
    tier: "low",
    grassTuftsPerSeed: 1,
    grassBladesPerTuft: 4,
    foliageDetail: 1,
    bushBlobs: 7,
    canopyBlobs: 4,
    sparkCount: 16,
    sparkResolutionScale: 0.5,
  },
  mid: {
    tier: "mid",
    grassTuftsPerSeed: 2,
    grassBladesPerTuft: 5,
    foliageDetail: 1,
    bushBlobs: 9,
    canopyBlobs: 5,
    sparkCount: 30,
    sparkResolutionScale: 0.75,
  },
  high: {
    tier: "high",
    grassTuftsPerSeed: 3,
    grassBladesPerTuft: 6,
    foliageDetail: 2,
    bushBlobs: 11,
    canopyBlobs: 6,
    sparkCount: 54,
    sparkResolutionScale: 1,
  },
};

/** Что известно об устройстве. Все поля необязательны: браузеры отдают их по-разному. */
export interface QualityProbe {
  /** navigator.hardwareConcurrency */
  cores?: number;
  /** navigator.deviceMemory, ГБ (есть только в Chromium, округляется до 8). */
  memoryGb?: number;
  /** Основной указатель — палец (телефон/планшет). */
  coarsePointer?: boolean;
  /** Явный выбор из адресной строки. */
  override?: string | null;
}

function isTier(value: unknown): value is QualityTier {
  return value === "low" || value === "mid" || value === "high";
}

/**
 * Выбор уровня. Консервативно: сомневаемся — берём «mid», а в «low» уходим при
 * явных признаках слабого железа, чтобы игра и так «взлетала» на самых простых
 * телефонах.
 */
export function pickTier(probe: QualityProbe): QualityTier {
  if (isTier(probe.override)) return probe.override;

  const { cores, memoryGb, coarsePointer } = probe;
  const weakMemory = memoryGb !== undefined && memoryGb <= 2;
  const weakCpu = cores !== undefined && (cores <= 2 || (coarsePointer === true && cores <= 4));
  if (weakMemory || weakCpu) return "low";

  const strongCpu = cores !== undefined && cores >= 8;
  const strongMemory = memoryGb === undefined || memoryGb >= 8;
  if (!coarsePointer && strongCpu && strongMemory) return "high";

  return "mid";
}

/** Снимает данные об устройстве из браузера; вне браузера (тесты на Node) возвращает пустой зонд. */
export function readProbe(): QualityProbe {
  const probe: QualityProbe = {};
  if (typeof navigator !== "undefined") {
    const nav = navigator as Navigator & { deviceMemory?: number };
    if (typeof nav.hardwareConcurrency === "number") probe.cores = nav.hardwareConcurrency;
    if (typeof nav.deviceMemory === "number") probe.memoryGb = nav.deviceMemory;
  }
  if (typeof window !== "undefined") {
    probe.coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
    probe.override = new URLSearchParams(window.location?.search ?? "").get("quality") ?? storedOverride();
  }
  return probe;
}

/** Выбор игрока из настроек; «auto» (и любое неизвестное значение) — не переопределяет автоопределение. */
function storedOverride(): string | null {
  const quality = loadSettings().graphics.quality;
  return quality === "auto" ? null : quality;
}

/** Уровень, который выбрало бы автоопределение (без адреса и настроек) — для подсказок в меню. */
export function detectAutoTier(): QualityTier {
  return pickTier({ ...readProbe(), override: null });
}

let current: QualityProfile | null = null;

/** Профиль текущего устройства (определяется один раз за сессию). */
export function getQuality(): QualityProfile {
  if (!current) current = QUALITY_PROFILES[pickTier(readProbe())];
  return current;
}

/** Принудительно задать уровень (тесты, будущее меню настроек). */
export function setQualityTier(tier: QualityTier): QualityProfile {
  current = QUALITY_PROFILES[tier];
  return current;
}
