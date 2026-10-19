import { hash01, valueNoise2 } from "../render/noise";

/**
 * Процедурная текстура старой бумаги для страниц: генерируется ОДИН раз за
 * сессию на маленьком канвасе (по умолчанию 192×256), превращается в data-URL и
 * переиспользуется всеми карточками как background-image. Никаких файлов и
 * сетевых запросов; растягивается CSS — бумага мягкая, высокое разрешение не нужно.
 *
 * Состав: тёплая основа с низкочастотными «облаками» и зерном, прогоревшие
 * неровные края, пятна «фоксинга» и редкие волокна. Всё детерминировано (хэш,
 * не Math.random) — страницы выглядят одинаково при каждом запуске.
 *
 * Без 2D-контекста (тесты, экзотика) возвращает null — CSS рисует запасной градиент.
 */

type Rgb = readonly [number, number, number];

const PAPER_LIGHT: Rgb = [236, 220, 176];
const PAPER_DARK: Rgb = [208, 180, 120];
const BURN: Rgb = [96, 62, 28];

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export interface ParchmentSize {
  width: number;
  height: number;
}

export const DEFAULT_PARCHMENT: ParchmentSize = { width: 192, height: 256 };
export const SMALL_PARCHMENT: ParchmentSize = { width: 128, height: 176 };

const cache = new Map<string, string | null>();

export function parchmentDataUrl(size: ParchmentSize = DEFAULT_PARCHMENT): string | null {
  const key = `${size.width}x${size.height}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  const url = renderParchment(size);
  cache.set(key, url);
  return url;
}

function renderParchment({ width: w, height: h }: ParchmentSize): string | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx || typeof ctx.createImageData !== "function") return null;

  const image = ctx.createImageData(w, h);
  const data = image.data;
  const halfMin = Math.min(w, h) * 0.5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cloud = valueNoise2(x / 40, y / 40, 1);
      const fine = valueNoise2(x / 7, y / 7, 2);
      const grain = hash01(x, y, 3);
      const t = 0.5 * cloud + 0.3 * fine + 0.2 * grain;
      let col = mix(PAPER_LIGHT, PAPER_DARK, t);

      // Края «обгорают» неровно: расстояние до края искажено плавным шумом (мелкий даёт лишь лёгкую рябь).
      const edge = Math.min(x, w - 1 - x, y, h - 1 - y) / halfMin;
      const wobble = (cloud - 0.5) * 0.4 + (fine - 0.5) * 0.08;
      const burn = Math.max(0, Math.min(1, 1 - (edge + wobble) * 5.2));
      col = mix(col, BURN, burn * burn * 0.72);

      const i = (y * w + x) * 4;
      data[i] = col[0];
      data[i + 1] = col[1];
      data[i + 2] = col[2];
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  // Пятна фоксинга (ржавые крапинки от времени).
  for (let i = 0; i < 7; i++) {
    const cx = hash01(i, 11) * w;
    const cy = hash01(i, 12) * h;
    const r = 6 + hash01(i, 13) * 18;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, "rgba(120,78,30,0.16)");
    g.addColorStop(1, "rgba(120,78,30,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  // Бумажные волокна.
  ctx.strokeStyle = "rgba(90,60,25,0.07)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 70; i++) {
    const x0 = hash01(i, 21) * w;
    const y0 = hash01(i, 22) * h;
    const a = hash01(i, 23) * Math.PI;
    const len = 4 + hash01(i, 24) * 14;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len);
    ctx.stroke();
  }

  try {
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return null;
  }
}
