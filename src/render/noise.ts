/**
 * Детерминированный «шум» без состояния: хэш целых чисел и value-noise на его основе.
 * Нужен там, где вариативность должна определяться самими данными (позицией сида,
 * индексом комка), а не общим генератором: тогда внешний вид не зависит от порядка
 * сборки, а SectionSpec остаётся единственным источником случайности мира.
 */

function mix(value: number): number {
  let h = value | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Хэш до четырёх целых → число в [0, 1). Дробные входы округляйте сами (например, Math.round(x * 100)). */
export function hash01(a: number, b = 0, c = 0, d = 0): number {
  let h = 0x9e3779b9;
  h = mix(h ^ Math.imul(a | 0, 0x85ebca6b));
  h = mix(h ^ Math.imul(b | 0, 0xc2b2ae35));
  h = mix(h ^ Math.imul(c | 0, 0x27d4eb2f));
  h = mix(h ^ Math.imul(d | 0, 0x165667b1));
  return h / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Плавный шум на плоскости, значения в [0, 1). Масштаб — размером ячейки в единицах входа (1 = ячейка 1×1). */
export function valueNoise2(x: number, z: number, seed = 0): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smooth(x - x0);
  const tz = smooth(z - z0);
  const a = hash01(x0, z0, seed);
  const b = hash01(x0 + 1, z0, seed);
  const c = hash01(x0, z0 + 1, seed);
  const d = hash01(x0 + 1, z0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

/** Плавный шум в пространстве, значения в [0, 1). */
export function valueNoise3(x: number, y: number, z: number, seed = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const tz = smooth(z - z0);
  const layer = (zz: number): number => {
    const a = hash01(x0, y0, zz, seed);
    const b = hash01(x0 + 1, y0, zz, seed);
    const c = hash01(x0, y0 + 1, zz, seed);
    const d = hash01(x0 + 1, y0 + 1, zz, seed);
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  };
  return lerp(layer(z0), layer(z0 + 1), tz);
}
