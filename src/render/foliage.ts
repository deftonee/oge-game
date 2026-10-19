import { Mesh, MeshBuilder, Scene, VertexBuffer } from "@babylonjs/core";
import { getQuality } from "../core/quality";
import { hash01, valueNoise3 } from "./noise";
import { mergeColored, mixRgb, paintMesh, rgb, scaleRgb, type Rgb } from "./coloredMesh";
import { perScene } from "./perScene";

/**
 * Листва: кусты и кроны деревьев как кучки «комков» — слегка помятых
 * низкополигональных ico-сфер разного размера, слитых в один меш с цветом в
 * вершинах (тёмный низ → светлый верх + разброс по комкам). Вместо одной гладкой
 * сферы получается неровный силуэт с «бугорками» листвы.
 *
 * Геометрия строится ОДИН раз на сцену (несколько вариантов каждого вида), а
 * каждый куст/дерево — это clone шаблона: независимый меш со своим transform и
 * `visibility` (стелс плавно делает прозрачным именно тот куст, где стоит
 * игрок), но с общей геометрией и общим материалом. Сборка чанка поэтому не
 * тратит время на генерацию и слияние мешей — важно для плавного стриминга на
 * слабых устройствах.
 *
 * ГАБАРИТ — часть игровой механики (см. stealth/bushes.ts и stealth/cover.ts):
 *  - «внутри куста» — это КРУГ в плане радиуса R, значит по горизонтали куст может
 *    занимать весь круг на любой высоте (цилиндр, а не сфера);
 *  - перекрытие обзора считается по сечению сферы радиуса R на высоте глаз, поэтому
 *    на уровне глаз куст/крона заполняют это сечение и не выступают за него.
 * Центр габарита — начало координат меша; низ куста стоит ровно на y = −R: куст
 * садится на землю при position.y = R×scale (см. SectionChunk.buildBushes).
 */

/** Радиус сферы-габарита куста в локальных координатах меша (раньше — радиус сферы Ø2.4). */
export const BUSH_ENVELOPE_RADIUS = 1.2;
/** Радиус сферы-габарита кроны в локальных координатах меша (раньше — сфера радиуса 1.1 при scale=1). */
export const CANOPY_ENVELOPE_RADIUS = 1.1;
/** Допуск на выступание комков за габарит: бугры неровные, но не больше этого. */
export const ENVELOPE_TOLERANCE = 1.06;

/** Вариантов шаблона каждого вида: соседние кусты/деревья не выглядят штампами. */
export const FOLIAGE_VARIANTS = 3;

export interface Blob {
  x: number;
  y: number;
  z: number;
  /** Радиус до помятости. */
  r: number;
  /** Сплющивание по вертикали: комки листвы шире, чем высокие. */
  squash: number;
}

interface Palette {
  shadow: Rgb;
  mid: Rgb;
  light: Rgb;
  /** Редкие светлые комки — «молодая листва». */
  fresh: Rgb;
}

const BUSH_PALETTE: Palette = {
  shadow: rgb("#235028"),
  mid: rgb("#3d7f37"),
  light: rgb("#62ab46"),
  fresh: rgb("#92c850"),
};
/** Заросли у края коридора чуть светлее и зеленее, чтобы не сливаться с тёмным краем пола. */
const THICKET_PALETTE: Palette = {
  shadow: rgb("#2a5a2e"),
  mid: rgb("#468a40"),
  light: rgb("#6cb54b"),
  fresh: rgb("#9acd57"),
};
const CANOPY_PALETTE: Palette = {
  shadow: rgb("#245a2e"),
  mid: rgb("#3f8c44"),
  light: rgb("#76bb4e"),
  fresh: rgb("#a6d65c"),
};

// ---------------------------------------------------------------------------
// Раскладка комков
// ---------------------------------------------------------------------------

/** Ярус комков: высота, расстояние от оси, радиус комка. */
interface Tier {
  y: number;
  dist: number;
  r: number;
  count: number;
}

function jitteredRing(tier: Tier, seed: number, tierIndex: number, angleOffset: number): Blob[] {
  const blobs: Blob[] = [];
  for (let i = 0; i < tier.count; i++) {
    const h = (k: number): number => hash01(seed, tierIndex, i, k);
    const angle = angleOffset + (i / tier.count) * Math.PI * 2 + (h(0) - 0.5) * 0.7;
    const r = tier.r * (0.88 + 0.24 * h(1));
    const squash = 0.78 + 0.12 * h(2);
    const dist = tier.count === 1 ? 0 : tier.dist * (0.9 + 0.2 * h(3));
    const y = tier.y + (h(4) - 0.5) * 0.12;
    blobs.push({ x: Math.sin(angle) * dist, y, z: Math.cos(angle) * dist, r, squash });
  }
  return blobs;
}

/** Запас на помятость комка: bump-шум раздувает вершины до ~+10 %. */
const BUMP_MARGIN = 1.12;

/**
 * Загоняет комки в габарит: если комок (с запасом на помятость) выступает, его
 * центр сдвигается внутрь. Так любая раскладка и любой джиттер остаются
 * «законными» для стелс-механики.
 *  - "cylinder" (кусты): по горизонтали — круг радиуса R, по вертикали — [−R, R];
 *  - "sphere" (кроны): шар радиуса R, плотно, по размеру комка.
 */
function fitInside(blobs: Blob[], envelope: number, shape: "cylinder" | "sphere"): Blob[] {
  const limit = envelope * 1.03;
  return blobs.map((b) => {
    const rH = b.r * BUMP_MARGIN;
    const rV = b.r * b.squash * BUMP_MARGIN;
    if (shape === "cylinder") {
      const horiz = Math.hypot(b.x, b.z);
      const k = horiz > limit - rH ? Math.max(0, (limit - rH) / horiz) : 1;
      const yMax = Math.max(0, envelope * 1.05 - rV);
      return { ...b, x: b.x * k, z: b.z * k, y: Math.max(-yMax, Math.min(yMax, b.y)) };
    }
    const reach = Math.hypot(b.x, b.y, b.z) + Math.max(rH, rV);
    if (reach <= limit) return b;
    const k = Math.max(0, (limit - Math.max(rH, rV)) / Math.hypot(b.x, b.y, b.z));
    return { ...b, x: b.x * k, y: b.y * k, z: b.z * k };
  });
}

/**
 * Куст: широкий низ (комки стоят на земле), средний ярус, невысокая «шапка».
 * Число комков задаёт профиль качества; ярусы делят его в фиксированных долях.
 */
export function bushLayout(count: number, seed: number): Blob[] {
  const crown = 1;
  const upper = count >= 8 ? 2 : 1;
  const rest = Math.max(2, count - crown - upper);
  const base = Math.max(2, Math.round(rest * 0.55));
  const mid = Math.max(1, rest - base);
  const phase = hash01(seed, 99) * Math.PI * 2;
  const tiers: Tier[] = [
    { y: -0.72, dist: 0.58, r: 0.62, count: base },
    { y: 0.05, dist: 0.52, r: 0.66, count: mid }, // этот ярус приходится на высоту глаз — он «держит» сечение укрытия
    { y: 0.52, dist: 0.3, r: 0.58, count: upper },
    { y: 0.74, dist: 0, r: 0.52, count: crown },
  ];
  return fitInside(
    tiers.flatMap((t, i) => jitteredRing(t, seed, i, phase + i * 0.9)),
    BUSH_ENVELOPE_RADIUS,
    "cylinder"
  );
}

/** Крона: шапка из нескольких комков вокруг центра, чуть выше — «макушка». */
export function canopyLayout(count: number, seed: number): Blob[] {
  const ring = Math.max(3, count - 1);
  const phase = hash01(seed, 77) * Math.PI * 2;
  const tiers: Tier[] = [
    { y: -0.12, dist: 0.5, r: 0.58, count: ring },
    { y: 0.42, dist: 0, r: 0.56, count: 1 },
  ];
  return fitInside(
    tiers.flatMap((t, i) => jitteredRing(t, seed, i, phase + i * 1.3)),
    CANOPY_ENVELOPE_RADIUS,
    "sphere"
  );
}

// ---------------------------------------------------------------------------
// Геометрия
// ---------------------------------------------------------------------------

/** Помятый комок: ico-сфера, вершины смещены шумом, масштаб и позиция применены к вершинам. */
function buildBlob(scene: Scene, name: string, blob: Blob, detail: number, seed: number): Mesh {
  const mesh = MeshBuilder.CreateIcoSphere(name, { radius: 1, subdivisions: detail, flat: true }, scene);
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const noiseSeed = Math.floor(hash01(seed, Math.round(blob.x * 100), Math.round(blob.z * 100)) * 1000);
  for (let i = 0; i < pos.length; i += 3) {
    // Шум зависит от позиции, а не от индекса: одинаковые точки соседних граней смещаются одинаково (без щелей).
    const bump = 1 + (valueNoise3(pos[i] * 1.7 + 11, pos[i + 1] * 1.7, pos[i + 2] * 1.7, noiseSeed) - 0.5) * 0.42;
    pos[i] = blob.x + pos[i] * blob.r * bump;
    pos[i + 1] = blob.y + pos[i + 1] * blob.r * blob.squash * bump;
    pos[i + 2] = blob.z + pos[i + 2] * blob.r * bump;
  }
  mesh.setVerticesData(VertexBuffer.PositionKind, pos);
  mesh.createNormals(false); // плоские грани → «огранённая» листва; вершины не общие, поэтому нормаль — грани
  return mesh;
}

interface FoliageSpec {
  blobs: Blob[];
  palette: Palette;
  /** Диапазон высоты для градиента «тёмный низ → светлый верх». */
  yRange: readonly [number, number];
  detail: number;
  seed: number;
  /** Если задано — весь кластер сдвигается по Y так, чтобы самая низкая точка лежала ровно здесь (посадка на землю). */
  groundY?: number;
}

/** Сдвиг всех вершин меша по Y (после сдвига нормали остаются верными). */
function shiftY(mesh: Mesh, dy: number): void {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 1; i < pos.length; i += 3) pos[i] += dy;
  mesh.setVerticesData(VertexBuffer.PositionKind, pos);
}

function* yValues(mesh: Mesh): Generator<number> {
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 1; i < pos.length; i += 3) yield pos[i];
}

function buildFoliage(scene: Scene, name: string, spec: FoliageSpec): Mesh {
  const { palette, yRange, seed } = spec;
  const meshes = spec.blobs.map((blob, i) => buildBlob(scene, `${name}_blob${i}`, blob, spec.detail, seed + i));
  if (spec.groundY !== undefined) {
    const lowest = Math.min(...meshes.map((m) => Math.min(...yValues(m))));
    meshes.forEach((m) => shiftY(m, spec.groundY! - lowest));
  }
  const parts = meshes.map((mesh, i) => {
    const blob = spec.blobs[i];
    const h = (k: number): number => hash01(seed, i, k, 5);
    // Свежие комки — редкие и только выше середины: верх куста кажется освещённее.
    const fresh = blob.y > yRange[0] * 0.2 && h(0) > 0.62;
    const tint = 0.9 + 0.2 * h(1);
    paintMesh(mesh, (x, y, z) => {
      const t = Math.max(0, Math.min(1, (y - yRange[0]) / (yRange[1] - yRange[0])));
      // Три остановки градиента: тень у земли → основной тон → свет сверху.
      const base = t < 0.5 ? mixRgb(palette.shadow, palette.mid, t * 2) : mixRgb(palette.mid, palette.light, (t - 0.5) * 2);
      const withFresh = fresh ? mixRgb(base, palette.fresh, 0.55 * t) : base;
      // Мелкая «зернистость» по позиции вершины — листва не выглядит гладким пластиком.
      const grain = 0.94 + 0.12 * hash01(Math.round(x * 50), Math.round(y * 50), Math.round(z * 50), seed);
      return scaleRgb(withFresh, tint * grain);
    });
    return mesh;
  });
  const merged = mergeColored(name, parts, scene);
  merged.setEnabled(false); // шаблон: рисуются только клоны
  return merged;
}

interface FoliageKit {
  bush: Mesh[];
  thicket: Mesh[];
  canopy: Mesh[];
}

const foliageKit = perScene((scene): FoliageKit => {
  const q = getQuality();
  const detail = q.foliageDetail;
  const make = (
    kind: string,
    palette: Palette,
    layout: (seed: number) => Blob[],
    yRange: readonly [number, number],
    groundY?: number
  ): Mesh[] =>
    Array.from({ length: FOLIAGE_VARIANTS }, (_, v) => {
      const seed = 1000 + v * 37 + kind.length;
      return buildFoliage(scene, `foliage_${kind}_tpl${v}`, { blobs: layout(seed), palette, yRange, detail, seed, groundY });
    });
  const E = BUSH_ENVELOPE_RADIUS;
  const C = CANOPY_ENVELOPE_RADIUS;
  return {
    bush: make("bush", BUSH_PALETTE, (s) => bushLayout(q.bushBlobs, s), [-E, E], -E),
    thicket: make("thicket", THICKET_PALETTE, (s) => bushLayout(q.bushBlobs, s + 5), [-E, E], -E),
    canopy: make("canopy", CANOPY_PALETTE, (s) => canopyLayout(q.canopyBlobs, s), [-C, C]),
  };
});

/** Клон шаблона: независимый видимый меш (свой transform и visibility) с общей геометрией и материалом. */
function cloneTemplate(templates: Mesh[], name: string, variantKey: number): Mesh {
  const template = templates[Math.floor(hash01(variantKey) * templates.length) % templates.length];
  const clone = template.clone(name);
  clone.setEnabled(true);
  clone.isVisible = true;
  clone.isPickable = false;
  return clone;
}

/** Ключ варианта из позиции (метры): одно и то же место — один и тот же вид, независимо от порядка сборки. */
export function variantKeyAt(x: number, z: number): number {
  return Math.round(x * 10) * 7919 + Math.round(z * 10);
}

/** Куст-укрытие (отдельный меш: у каждого своя прозрачность). */
export function createBush(scene: Scene, name: string, variantKey: number): Mesh {
  return cloneTemplate(foliageKit(scene).bush, name, variantKey);
}

/**
 * Основа зарослей у края коридора: из неё делаются instances. Сама невидима
 * (рисуются только инстансы), остаётся источником геометрии и материала.
 */
export function createThicketBase(scene: Scene, name: string, variantKey: number): Mesh {
  const base = cloneTemplate(foliageKit(scene).thicket, name, variantKey);
  base.isVisible = false;
  return base;
}

/** Крона дерева (отдельный меш: прозрачнеет, когда она между камерой и игроком). */
export function createCanopy(scene: Scene, name: string, variantKey: number): Mesh {
  return cloneTemplate(foliageKit(scene).canopy, name, variantKey);
}
