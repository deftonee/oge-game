import { Color3, DynamicTexture, MeshBuilder, Texture, StandardMaterial, Vector2, type Mesh, type Scene } from "@babylonjs/core";
import { perScene } from "../../../render/perScene";
import { hash01 } from "../../../render/noise";
import { PLAQUE } from "./layout";

/**
 * Процедурные текстуры стимпанк-цеха: клёпаные стальные плиты на полу и латунные
 * таблички с формулами. Рисуются один раз на сцену в маленький canvas (без файлов
 * и загрузок).
 *
 * Всё необязательно: без canvas (Node-тесты на NullEngine, редкие браузеры) любая
 * функция возвращает null, а вызывающий откатывается на однотонный пол и пустую
 * тёмную табличку — игра работает так же, просто скромнее.
 */

/** Сторона одной стальной плиты пола, м. Текстура — 2×2 плиты, поэтому повторяется раз в 2·PLATE. */
export const FLOOR_PLATE = 1.5;

function tryMake<T>(make: () => T): T | null {
  try {
    return make();
  } catch {
    return null;
  }
}

// ---------- Пол ----------

/** Серая рифлёная сталь с заклёпками: умножается на цвет секции (бронзовый отлив, темнее с ростом сложности). */
export const steampunkFloorTexture = perScene((scene): Texture | null =>
  tryMake(() => {
    const size = 256;
    const tex = new DynamicTexture("steampunkFloorTex", { width: size, height: size }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    const ctx = tex.getContext() as CanvasRenderingContext2D | null;
    if (!ctx) {
      tex.dispose();
      return null;
    }
    const half = size / 2;
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        const x0 = tx * half;
        const y0 = ty * half;
        const base = (tx + ty) % 2 === 0 ? 226 : 206;
        ctx.fillStyle = `rgb(${base},${base},${base})`;
        ctx.fillRect(x0, y0, half, half);

        // Рифление: ряды коротких чёрточек, в соседних рядах наклон в разные стороны.
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        const step = 14;
        for (let gy = 0; gy < 8; gy++) {
          for (let gx = 0; gx < 8; gx++) {
            const cx = x0 + 9 + gx * step;
            const cy = y0 + 9 + gy * step;
            const lean = (gx + gy) % 2 === 0 ? 1 : -1;
            ctx.strokeStyle = "rgba(255,255,255,0.45)";
            ctx.beginPath();
            ctx.moveTo(cx - 3 * lean, cy - 3);
            ctx.lineTo(cx + 3 * lean, cy + 3);
            ctx.stroke();
            ctx.strokeStyle = "rgba(40,36,32,0.38)";
            ctx.beginPath();
            ctx.moveTo(cx - 3 * lean + 1.5, cy - 3 + 1.5);
            ctx.lineTo(cx + 3 * lean + 1.5, cy + 3 + 1.5);
            ctx.stroke();
          }
        }

        // Копоть и ржавые потёки — плита не выглядит пластиком.
        for (let i = 0; i < 70; i++) {
          const gx = x0 + hash01(tx, ty, i, 1) * half;
          const gy = y0 + hash01(tx, ty, i, 2) * half;
          const d = Math.round((hash01(tx, ty, i, 3) - 0.6) * 46);
          ctx.fillStyle = `rgba(${base + d},${base + d},${base + d},0.5)`;
          ctx.fillRect(gx, gy, 3, 3);
        }

        // Шов между плитами.
        ctx.strokeStyle = "rgba(24,20,18,0.8)";
        ctx.lineWidth = 4;
        ctx.strokeRect(x0 + 2, y0 + 2, half - 4, half - 4);

        // Заклёпки по углам.
        for (const [rx, ry] of [
          [10, 10],
          [half - 10, 10],
          [10, half - 10],
          [half - 10, half - 10],
        ] as const) {
          ctx.fillStyle = "rgba(30,26,22,0.85)";
          ctx.beginPath();
          ctx.arc(x0 + rx + 1, y0 + ry + 1, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.beginPath();
          ctx.arc(x0 + rx, y0 + ry, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = 4;
    tex.update();
    return tex;
  })
);

// ---------- Латунные таблички ----------

const PLAQUE_TEXTURE = { width: 640, height: 214 };
/** Плоскость с гравировкой чуть меньше тёмной поверхности таблички. */
const PLAQUE_PLANE = { w: PLAQUE.len - 0.3, h: PLAQUE.h - 0.3 };

type Ctx = CanvasRenderingContext2D;

const AMBER = "#f0be68";
const AMBER_DIM = "rgba(240,190,104,0.55)";

interface PlaqueArt {
  title: string;
  lines: readonly string[];
  art: "thermometer" | "kettle" | "piston";
}

/**
 * Что выгравировано на табличках: формулы заклинаний школы пламени (data/spells/fire.json) —
 * табличка учит прямо в мире. Меняя текст здесь, ничего больше трогать не нужно.
 */
const PLAQUE_ART: readonly PlaqueArt[] = [
  { title: "Температура и тепловое движение", lines: ["t = T − 273"], art: "thermometer" },
  { title: "Количество теплоты", lines: ["Q = c · m · Δt"], art: "kettle" },
  { title: "КПД теплового двигателя", lines: ["η = A / Qн"], art: "piston" },
];

function stroke(ctx: Ctx, width: number, alpha = 0.95): void {
  ctx.strokeStyle = `rgba(240,190,104,${alpha})`;
  ctx.fillStyle = `rgba(240,190,104,${alpha})`;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

/** Термометр: трубка со шкалой, шарик внизу, красный столбик. */
function drawThermometer(ctx: Ctx, x: number, y: number, h: number): void {
  stroke(ctx, 3);
  // Трубка со скруглённым верхом (без roundRect — он есть не во всех браузерах).
  ctx.beginPath();
  ctx.moveTo(x - 9, y + h - 22);
  ctx.lineTo(x - 9, y + 9);
  ctx.arc(x, y + 9, 9, Math.PI, 0);
  ctx.lineTo(x + 9, y + h - 22);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y + h - 13, 15, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const ty = y + 14 + i * ((h - 70) / 5);
    ctx.beginPath();
    ctx.moveTo(x + 14, ty);
    ctx.lineTo(x + (i % 2 === 0 ? 28 : 22), ty);
    ctx.stroke();
  }
  ctx.fillStyle = "#e0553a";
  ctx.beginPath();
  ctx.arc(x, y + h - 13, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - 3, y + h * 0.45, 6, h * 0.55 - 20);
}

/** Чайник над пламенем: нагрев воды — «Q = c·m·Δt». */
function drawKettle(ctx: Ctx, x: number, y: number): void {
  stroke(ctx, 3);
  // Корпус.
  ctx.beginPath();
  ctx.moveTo(x - 38, y + 30);
  ctx.quadraticCurveTo(x - 46, y + 74, x - 22, y + 78);
  ctx.lineTo(x + 22, y + 78);
  ctx.quadraticCurveTo(x + 46, y + 74, x + 38, y + 30);
  ctx.closePath();
  ctx.stroke();
  // Крышка и носик, ручка.
  ctx.beginPath();
  ctx.moveTo(x - 30, y + 30);
  ctx.lineTo(x + 30, y + 30);
  ctx.moveTo(x, y + 30);
  ctx.lineTo(x, y + 18);
  ctx.moveTo(x + 38, y + 44);
  ctx.quadraticCurveTo(x + 62, y + 38, x + 66, y + 20);
  ctx.moveTo(x - 38, y + 40);
  ctx.quadraticCurveTo(x - 66, y + 36, x - 60, y + 62);
  ctx.quadraticCurveTo(x - 56, y + 70, x - 42, y + 66);
  ctx.stroke();
  // Пар.
  ctx.beginPath();
  ctx.moveTo(x + 66, y + 14);
  ctx.quadraticCurveTo(x + 76, y + 4, x + 68, y - 6);
  ctx.stroke();
  // Пламя.
  ctx.fillStyle = "#ee8a3a";
  for (const dx of [-18, 0, 18]) {
    ctx.beginPath();
    ctx.moveTo(x + dx - 8, y + 104);
    ctx.quadraticCurveTo(x + dx - 8, y + 92, x + dx, y + 84);
    ctx.quadraticCurveTo(x + dx + 8, y + 92, x + dx + 8, y + 104);
    ctx.closePath();
    ctx.fill();
  }
}

/** Схема поршня: цилиндр, шток, кривошип и маховик — «η = A / Qн». */
function drawPiston(ctx: Ctx, x: number, y: number): void {
  stroke(ctx, 3);
  // Цилиндр и поршень.
  ctx.strokeRect(x - 80, y + 18, 90, 46);
  ctx.fillRect(x - 30, y + 22, 10, 38);
  // Шток и шатун.
  ctx.beginPath();
  ctx.moveTo(x - 20, y + 41);
  ctx.lineTo(x + 40, y + 41);
  ctx.lineTo(x + 66, y + 64);
  ctx.stroke();
  // Маховик.
  ctx.beginPath();
  ctx.arc(x + 76, y + 50, 38, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + 76, y + 50, 6, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(x + 76 - Math.cos(a) * 36, y + 50 - Math.sin(a) * 36);
    ctx.lineTo(x + 76 + Math.cos(a) * 36, y + 50 + Math.sin(a) * 36);
    ctx.stroke();
  }
  // Стрелка подвода тепла (Qн) под цилиндром.
  ctx.fillStyle = "#ee8a3a";
  ctx.beginPath();
  ctx.moveTo(x - 62, y + 100);
  ctx.lineTo(x - 62, y + 74);
  ctx.lineTo(x - 72, y + 84);
  ctx.moveTo(x - 62, y + 74);
  ctx.lineTo(x - 52, y + 84);
  ctx.strokeStyle = "#ee8a3a";
  ctx.stroke();
}

function paintPlaque(ctx: Ctx, art: PlaqueArt, seed: number): void {
  const { width, height } = PLAQUE_TEXTURE;
  // Тёмная копчёная латунь.
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, "#2a211a");
  grad.addColorStop(1, "#171210");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  // Следы копоти.
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(255,220,160,${0.012 + hash01(seed, i, 1) * 0.02})`;
    ctx.fillRect(hash01(seed, i, 2) * width, hash01(seed, i, 3) * height, 40 + hash01(seed, i, 4) * 90, 2 + hash01(seed, i, 5) * 6);
  }
  // Двойная гравированная рамка.
  stroke(ctx, 2, 0.7);
  ctx.strokeRect(10, 10, width - 20, height - 20);
  stroke(ctx, 1, 0.45);
  ctx.strokeRect(17, 17, width - 34, height - 34);

  const font = "'Georgia','Times New Roman','Palatino Linotype',serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = AMBER_DIM;
  ctx.font = `italic 27px ${font}`;
  ctx.fillText(art.title, 40, 58);
  stroke(ctx, 2, 0.6);
  ctx.beginPath();
  ctx.moveTo(40, 70);
  ctx.lineTo(40 + ctx.measureText(art.title).width, 70);
  ctx.stroke();

  // Формула: тень гравировки + светлая основа.
  ctx.font = `bold 66px ${font}`;
  art.lines.forEach((line, i) => {
    const ly = 150 + i * 62 - (art.lines.length - 1) * 24;
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillText(line, 45, ly + 3);
    ctx.fillStyle = AMBER;
    ctx.fillText(line, 42, ly);
  });

  if (art.art === "thermometer") drawThermometer(ctx, width - 110, 78, 112);
  if (art.art === "kettle") drawKettle(ctx, width - 130, 66);
  if (art.art === "piston") drawPiston(ctx, width - 150, 78);
}

/**
 * Материалы табличек с гравировкой — по одному на надпись (PLAQUE_ART); элемент null,
 * если canvas недоступен. Один материал на все таблички одного вида.
 */
export const plaqueMaterials = perScene((scene): (StandardMaterial | null)[] =>
  PLAQUE_ART.map((art, i) =>
    tryMake(() => {
      const tex = new DynamicTexture(`plaqueTex_${i}`, PLAQUE_TEXTURE, scene, true);
      const ctx = tex.getContext() as CanvasRenderingContext2D | null;
      if (!ctx) {
        tex.dispose();
        return null;
      }
      paintPlaque(ctx, art, 60 + i);
      tex.update();
      const mat = new StandardMaterial(`plaqueMat_${i}`, scene);
      mat.diffuseTexture = tex;
      mat.emissiveColor = new Color3(0.34, 0.34, 0.34); // не проваливается в тень под боковым светом
      mat.specularColor = Color3.Black();
      return mat;
    })
  )
);

export const PLAQUE_ART_COUNT = PLAQUE_ART.length;

/** Плоскость-«гравировка» (шаблон под инстансы); null — нет текстуры, табличка остаётся тёмной. */
export const plaquePlanes = perScene((scene): (Mesh | null)[] =>
  plaqueMaterials(scene).map((mat, i) => {
    if (!mat) return null;
    const plane = MeshBuilder.CreatePlane(`plaquePlane_${i}`, { width: PLAQUE_PLANE.w, height: PLAQUE_PLANE.h }, scene);
    plane.material = mat;
    plane.isPickable = false;
    plane.setEnabled(false); // шаблон: рисуются только инстансы
    return plane;
  })
);

// ---------- Материал пола ----------

/**
 * Материал пола секции: клёпаная сталь, подкрашенная цветом секции. null — текстуры
 * нет (тогда SectionChunk берёт обычный однотонный материал).
 */
export function createSteampunkFloorMaterial(scene: Scene, name: string, colorHex: string): StandardMaterial | null {
  const tex = steampunkFloorTexture(scene);
  if (!tex) return null;
  const mat = new StandardMaterial(name, scene);
  mat.diffuseTexture = tex;
  mat.diffuseColor = Color3.FromHexString(colorHex);
  mat.specularColor = Color3.Black();
  return mat;
}

/**
 * UV для ленты пола — ПЛОСКОЕ отображение по мировым XZ: плиты одного размера на
 * всех кусках пола (полосы, заплатки шва, ниши) и без швов между секциями.
 * Порядок — как у вершин CreateRibbon: путь за путём, точка за точкой.
 */
export function steampunkFloorUvs(paths: readonly { x: number; z: number }[][]): Vector2[] {
  const k = 1 / (2 * FLOOR_PLATE);
  return paths.flatMap((path) => path.map((p) => new Vector2(p.x * k, p.z * k)));
}
