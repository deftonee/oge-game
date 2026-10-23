// Профиль качества: выбор уровня по характеристикам устройства и согласованность
// профилей (слабее уровень — не тяжелее сильного).
import { QUALITY_PROFILES, getQuality, pickTier, qualityFromUrl, readProbe, setQualityTier } from "../src/core/quality";
import { defaultSettings } from "../src/settings/settings";
import { SETTINGS_KEY } from "../src/settings/settingsStorage";
import type { QualityProfile } from "../src/core/quality";

declare const process: { exit(code?: number): never };

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

// --- выбор уровня -----------------------------------------------------------
check(pickTier({}) === "mid", "без данных об устройстве — «mid»");
check(pickTier({ override: "low" }) === "low", "?quality=low уважается");
check(pickTier({ override: "high", cores: 2, memoryGb: 1 }) === "high", "явный выбор сильнее эвристики");
check(pickTier({ override: "ultra" }) === "mid", "неизвестное значение игнорируется");
check(pickTier({ cores: 2 }) === "low", "2 ядра — слабое устройство");
check(pickTier({ memoryGb: 2 }) === "low", "2 ГБ памяти — слабое устройство");
check(pickTier({ cores: 4, coarsePointer: true }) === "low", "4 ядра + палец — слабый телефон");
check(pickTier({ cores: 4, coarsePointer: false }) === "mid", "4 ядра у мыши — средний ПК");
check(pickTier({ cores: 8, coarsePointer: true }) === "mid", "8 ядер, но телефон — «mid», не «high»");
check(pickTier({ cores: 8, memoryGb: 8, coarsePointer: false }) === "high", "мощный ПК — «high»");
check(pickTier({ cores: 16, memoryGb: 4, coarsePointer: false }) === "mid", "мало памяти — не «high»");
check(pickTier({ cores: 12, coarsePointer: false }) === "high", "память неизвестна — не мешает «high»");

// --- уровень из адреса -------------------------------------------------------
check(qualityFromUrl("?quality=low") === "low" && qualityFromUrl("?a=1&quality=high") === "high", "?quality=low|mid|high читается");
check(qualityFromUrl("") === null && qualityFromUrl("?x=1") === null, "без параметра — null");
check(qualityFromUrl("?quality=") === null, "пустое ?quality= — не выбор");
check(qualityFromUrl("?quality=ultra") === null && qualityFromUrl("?quality=LOW") === null, "мусор и неверный регистр — не выбор");

// Настройка игрока не должна пропадать из-за мусора в адресе (раньше «?quality=опечатка» перебивала её).
const g = globalThis as unknown as Record<string, unknown>;
function probeWith(search: string, storedQuality: string): string | null | undefined {
  const stored = { ...defaultSettings(), graphics: { ...defaultSettings().graphics, quality: storedQuality } };
  g.window = {
    location: { search },
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: (k: string) => (k === SETTINGS_KEY ? JSON.stringify(stored) : null), setItem: () => {} },
  };
  try {
    return readProbe().override;
  } finally {
    delete g.window;
  }
}
check(probeWith("", "low") === "low", "адреса нет → берётся настройка игрока");
check(probeWith("?quality=ultra", "low") === "low", "мусор в адресе → настройка игрока не теряется");
check(probeWith("?quality=", "low") === "low", "пустое значение в адресе → настройка игрока не теряется");
check(probeWith("?quality=high", "low") === "high", "корректный адрес сильнее настройки");
check(probeWith("?quality=ultra", "auto") === null, "мусор + «авто» → автоопределение");

// --- профили ----------------------------------------------------------------
const order: QualityProfile[] = [QUALITY_PROFILES.low, QUALITY_PROFILES.mid, QUALITY_PROFILES.high];
const numericKeys = [
  "grassTuftsPerSeed",
  "grassBladesPerTuft",
  "foliageDetail",
  "bushBlobs",
  "canopyBlobs",
  "sparkCount",
  "sparkResolutionScale",
] as const;
for (const key of numericKeys) {
  check(order[0][key] <= order[1][key] && order[1][key] <= order[2][key], `${key}: low ≤ mid ≤ high`);
  check(order.every((p) => p[key] > 0), `${key}: везде положителен (low тоже что-то рисует)`);
}
check(order.every((p) => p.sparkResolutionScale <= 1), "канвас искр не больше экрана");
check(order.every((p, i) => p.tier === (["low", "mid", "high"] as const)[i]), "поле tier совпадает с ключом");

// --- кэш --------------------------------------------------------------------
setQualityTier("low");
check(getQuality().tier === "low", "setQualityTier(low) → getQuality() = low");
setQualityTier("high");
check(getQuality() === QUALITY_PROFILES.high, "getQuality() отдаёт тот же объект профиля");

if (failures > 0) {
  console.error(`\n${failures} из ${checks} проверок не прошли`);
  process.exit(1);
}
console.log(`OK: профиль качества прошёл ${checks} проверок`);
