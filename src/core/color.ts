/**
 * Чистая математика цвета на hex-строках (без зависимостей от Babylon и DOM):
 * один набор для 3D (обложки книг в рюкзаке) и для интерфейса (карточки находок).
 */

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const n = parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(n)) throw new Error(`Некорректный hex-цвет: "${hex}"`);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clampByte(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Умножает яркость: k < 1 — темнее, k > 1 — светлее (с обрезкой до белого). */
export function shadeHex(hex: string, k: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(r * k, g * k, b * k);
}

/** Линейная смесь двух цветов: t = 0 → a, t = 1 → b. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** "#rrggbb" → "r, g, b" для rgba(var(--x), a) в CSS. */
export function hexToRgbTriplet(hex: string): string {
  return parseHex(hex).join(", ");
}
