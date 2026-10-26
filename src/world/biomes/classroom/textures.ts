import { Color3, DynamicTexture, MeshBuilder, Texture, StandardMaterial, Vector2, type Mesh, type Scene } from "@babylonjs/core";
import { perScene } from "../../../render/perScene";
import { hash01 } from "../../../render/noise";
import { BOARD } from "./layout";

/**
 * Процедурные текстуры класса: плитка на полу и мел на досках. Рисуются один раз
 * на сцену в маленький canvas (без файлов и загрузок).
 *
 * Всё необязательно: без canvas (Node-тесты на NullEngine, редкие браузеры) любая
 * функция возвращает null, а вызывающий откатывается на однотонный пол и пустую
 * зелёную доску — игра работает так же, просто скромнее.
 */

/** Сторона одной плитки пола, м. Текстура — 2×2 плитки, поэтому повторяется раз в 2·TILE. */
export const FLOOR_TILE = 1.2;

function tryMake<T>(make: () => T): T | null {
  try {
    return make();
  } catch {
    return null;
  }
}

// ---------- Пол ----------

/** Серая «шахматка» с затиркой: умножается на цвет секции (паркет/линолеум по сложности). */
export const classroomFloorTexture = perScene((scene): Texture | null =>
  tryMake(() => {
    const size = 256;
    const tex = new DynamicTexture("classroomFloorTex", { width: size, height: size }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    const ctx = tex.getContext() as CanvasRenderingContext2D | null;
    if (!ctx) {
      tex.dispose();
      return null;
    }
    const half = size / 2;
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        const light = (tx + ty) % 2 === 0;
        const base = light ? 238 : 214;
        ctx.fillStyle = `rgb(${base},${base},${base})`;
        ctx.fillRect(tx * half, ty * half, half, half);
        // Лёгкая зернистость — плитка не выглядит пластиком.
        for (let i = 0; i < 120; i++) {
          const gx = tx * half + hash01(tx, ty, i, 1) * half;
          const gy = ty * half + hash01(tx, ty, i, 2) * half;
          const d = Math.round((hash01(tx, ty, i, 3) - 0.5) * 22);
          ctx.fillStyle = `rgba(${base + d},${base + d},${base + d},0.55)`;
          ctx.fillRect(gx, gy, 2, 2);
        }
        // Затирка по краям плитки.
        ctx.strokeStyle = "rgba(90,80,70,0.55)";
        ctx.lineWidth = 3;
        ctx.strokeRect(tx * half + 1.5, ty * half + 1.5, half - 3, half - 3);
      }
    }
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = 4;
    tex.update();
    return tex;
  })
);

// ---------- Доски ----------

const BOARD_TEXTURE = { width: 640, height: 214 };
/** Плоскость с мелом чуть меньше зелёной поверхности доски. */
const CHALK_PLANE = { w: BOARD.len - 0.3, h: BOARD.h - 0.3 };

type ChalkCtx = CanvasRenderingContext2D;

function chalk(ctx: ChalkCtx, alpha = 0.9): void {
  ctx.fillStyle = `rgba(246,244,232,${alpha})`;
  ctx.strokeStyle = `rgba(246,244,232,${alpha})`;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

/** Схема цепи: рамка, батарея слева, резистор-зигзаг сверху, лампа справа. */
function drawCircuit(ctx: ChalkCtx, x: number, y: number, w: number, h: number): void {
  chalk(ctx, 0.85);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.stroke();
  // Закрасим куски рамки под элементами фоном доски.
  ctx.fillStyle = "#2f4a3a";
  ctx.fillRect(x - 3, y + h * 0.35, 6, h * 0.3); // батарея
  ctx.fillRect(x + w * 0.3, y - 3, w * 0.4, 6); // резистор
  ctx.fillRect(x + w - 3, y + h * 0.3, 6, h * 0.4); // лампа
  chalk(ctx, 0.9);
  ctx.lineWidth = 3;
  // Батарея: две пары чёрточек.
  for (const [dy, len] of [[0.38, 16], [0.46, 8], [0.54, 16], [0.62, 8]] as const) {
    ctx.beginPath();
    ctx.moveTo(x - len, y + h * dy);
    ctx.lineTo(x + len, y + h * dy);
    ctx.stroke();
  }
  // Резистор: зигзаг.
  ctx.beginPath();
  const rx = x + w * 0.3;
  const rw = w * 0.4;
  ctx.moveTo(rx, y);
  for (let i = 1; i <= 6; i++) ctx.lineTo(rx + (rw * i) / 6, y + (i % 2 === 1 ? -8 : 8));
  ctx.lineTo(rx + rw, y);
  ctx.stroke();
  // Лампа: кружок с крестом.
  const lx = x + w;
  const ly = y + h / 2;
  ctx.beginPath();
  ctx.arc(lx, ly, 13, 0, Math.PI * 2);
  ctx.moveTo(lx - 9, ly - 9);
  ctx.lineTo(lx + 9, ly + 9);
  ctx.moveTo(lx + 9, ly - 9);
  ctx.lineTo(lx - 9, ly + 9);
  ctx.stroke();
}

function drawBolt(ctx: ChalkCtx, x: number, y: number, s: number): void {
  chalk(ctx, 0.9);
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x + 0.55 * s, y);
  ctx.lineTo(x + 0.15 * s, y + 0.55 * s);
  ctx.lineTo(x + 0.5 * s, y + 0.55 * s);
  ctx.lineTo(x + 0.2 * s, y + 1.1 * s);
  ctx.lineTo(x + 0.8 * s, y + 0.4 * s);
  ctx.lineTo(x + 0.45 * s, y + 0.4 * s);
  ctx.closePath();
  ctx.stroke();
}

interface BoardArt {
  title: string;
  lines: readonly string[];
  art: "circuit" | "bolt" | "none";
}

/**
 * Что нарисовано на досках: формулы заклинаний школы грозы (data/spells/storm.json) —
 * доска учит прямо в мире. Меняя текст здесь, ничего больше трогать не нужно.
 */
const BOARD_ART: readonly BoardArt[] = [
  { title: "Закон Ома", lines: ["I = U / R"], art: "circuit" },
  { title: "Мощность тока", lines: ["P = U · I", "A = P · t"], art: "bolt" },
  { title: "Закон Джоуля — Ленца", lines: ["Q = I² · R · t"], art: "none" },
];

function paintBoard(ctx: ChalkCtx, art: BoardArt, seed: number): void {
  const { width, height } = BOARD_TEXTURE;
  ctx.fillStyle = "#2f4a3a";
  ctx.fillRect(0, 0, width, height);
  // Следы от тряпки.
  for (let i = 0; i < 7; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.025 + hash01(seed, i, 1) * 0.035})`;
    ctx.lineWidth = 26 + hash01(seed, i, 2) * 30;
    ctx.beginPath();
    const y0 = hash01(seed, i, 3) * height;
    ctx.moveTo(-20, y0);
    ctx.quadraticCurveTo(width * 0.5, y0 + (hash01(seed, i, 4) - 0.5) * 90, width + 20, y0 + (hash01(seed, i, 5) - 0.5) * 60);
    ctx.stroke();
  }
  const font = "'Segoe Script','Bradley Hand','Comic Sans MS','Marker Felt',cursive,sans-serif";
  chalk(ctx);
  ctx.textBaseline = "alphabetic";
  ctx.font = `italic 34px ${font}`;
  ctx.fillText(art.title, 34, 56);
  // Подчёркивание заголовка.
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(34, 68);
  ctx.lineTo(34 + ctx.measureText(art.title).width, 70);
  ctx.stroke();

  ctx.font = `bold 66px ${font}`;
  art.lines.forEach((line, i) => ctx.fillText(line, 40, 144 + i * 62 - (art.lines.length - 1) * 24));

  if (art.art === "circuit") drawCircuit(ctx, width - 250, 86, 190, 88);
  if (art.art === "bolt") drawBolt(ctx, width - 170, 70, 110);
}

/**
 * Материалы досок с мелом — по одному на надпись (BOARD_ART); элемент null, если
 * canvas недоступен. Один материал на все доски одного вида.
 */
export const chalkboardMaterials = perScene((scene): (StandardMaterial | null)[] =>
  BOARD_ART.map((art, i) =>
    tryMake(() => {
      const tex = new DynamicTexture(`chalkTex_${i}`, BOARD_TEXTURE, scene, true);
      const ctx = tex.getContext() as CanvasRenderingContext2D | null;
      if (!ctx) {
        tex.dispose();
        return null;
      }
      paintBoard(ctx, art, 40 + i);
      tex.update();
      const mat = new StandardMaterial(`chalkMat_${i}`, scene);
      mat.diffuseTexture = tex;
      mat.emissiveColor = new Color3(0.32, 0.32, 0.32); // не проваливается в тень под боковым светом
      mat.specularColor = Color3.Black();
      return mat;
    })
  )
);

export const BOARD_ART_COUNT = BOARD_ART.length;

/** Плоскость-«мел» (шаблон под инстансы); null — нет текстуры, доска остаётся зелёной. */
export const chalkPlanes = perScene((scene): (Mesh | null)[] =>
  chalkboardMaterials(scene).map((mat, i) => {
    if (!mat) return null;
    const plane = MeshBuilder.CreatePlane(`chalkPlane_${i}`, { width: CHALK_PLANE.w, height: CHALK_PLANE.h }, scene);
    plane.material = mat;
    plane.isPickable = false;
    plane.setEnabled(false); // шаблон: рисуются только инстансы
    return plane;
  })
);

// ---------- Материал пола ----------

/**
 * Материал пола секции: плитка, подкрашенная цветом секции. null — текстуры нет
 * (тогда SectionChunk берёт обычный однотонный материал).
 */
export function createClassroomFloorMaterial(scene: Scene, name: string, colorHex: string): StandardMaterial | null {
  const tex = classroomFloorTexture(scene);
  if (!tex) return null;
  const mat = new StandardMaterial(name, scene);
  mat.diffuseTexture = tex;
  mat.diffuseColor = Color3.FromHexString(colorHex);
  mat.specularColor = Color3.Black();
  return mat;
}

/**
 * UV для ленты пола — ПЛОСКОЕ отображение по мировым XZ: плитка одного размера на
 * всех кусках пола (полосы, заплатки шва, ниши) и без швов между секциями.
 * Порядок — как у вершин CreateRibbon: путь за путём, точка за точкой.
 */
export function floorUvs(paths: readonly { x: number; z: number }[][]): Vector2[] {
  const k = 1 / (2 * FLOOR_TILE);
  return paths.flatMap((path) => path.map((p) => new Vector2(p.x * k, p.z * k)));
}
