import { Color3, Matrix, Mesh, Quaternion, Scene, StandardMaterial, Vector3, VertexData } from "@babylonjs/core";
import { hash01, valueNoise2 } from "./noise";
import { mixRgb, rgb, scaleRgb, type Rgb } from "./coloredMesh";
import { perScene } from "./perScene";

/**
 * Трава: пучок из нескольких изогнутых травинок вместо одиноких конусов.
 *
 * Всё держится на одном базовом меше-пучке и тонких инстансах (один draw call
 * на секцию): сид из SectionSpec разворачивается в несколько пучков вокруг своей
 * точки (число зависит от профиля качества), а вариативность (поворот, высота,
 * смещение, «сухие/густые» пятна луга) берётся из хэша координат — SectionSpec
 * и его детерминизм не трогаются.
 *
 * Бюджет: травинка = 5 вершин и 3 треугольника (ромб-лист с изломом посередине),
 * без текстур, без прозрачности; пучок из 6 травинок — 18 треугольников. Старый
 * конус (Babylon CreateCylinder с tessellation по умолчанию) стоил 96 треугольников
 * и выглядел хуже.
 */

/** Точка раскладки: мировые координаты, поворот и масштаб (из сида секции). */
export interface GrassPoint {
  x: number;
  z: number;
  rot: number;
  scale: number;
}

const GRASS_ROOT = rgb("#27501f"); // тень у земли
const GRASS_MID = rgb("#4f8f32");
const GRASS_TIP = rgb("#9fd05a"); // подсвеченный кончик
const GRASS_DRY_TIP = rgb("#c4c15c"); // выгоревший кончик

/** Материал травы: вершинные цвета, но двусторонний (травинка — плоский лист); один на сцену. */
export const grassMaterial = perScene((scene) => {
  const mat = new StandardMaterial("grassMat", scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = Color3.Black();
  mat.backFaceCulling = false;
  return mat;
});

/** Максимальная высота пучка при scale=1 (метры): нужна тестам и подбору плотности. */
export const GRASS_TUFT_MAX_HEIGHT = 0.5;
/** Радиус пятна пучка при scale=1 (метры). */
export const GRASS_TUFT_RADIUS = 0.32;

const TUFT_SEED = 7;

/**
 * Геометрия пучка в локальных координатах (низ на y=0, центр в начале координат).
 * Базовый меш обязан остаться в identity-трансформе — иначе тонкие инстансы
 * получат двойное преобразование (см. комментарий в SectionChunk).
 */
export function createGrassTuft(scene: Scene, name: string, blades: number): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const pushVertex = (x: number, y: number, z: number, nx: number, nz: number, color: Rgb): void => {
    positions.push(x, y, z);
    const len = Math.hypot(nx, 1, nz);
    normals.push(nx / len, 1 / len, nz / len); // нормали «вверх»: трава мягко светится, как земля под ней
    colors.push(color[0], color[1], color[2], 1);
  };

  for (let i = 0; i < blades; i++) {
    const h = (k: number): number => hash01(i, k, blades, TUFT_SEED);
    const angle = i * 2.399963 + (h(0) - 0.5) * 0.6; // золотой угол — равномерный веер
    const radial = i === 0 ? 0 : 0.03 + 0.1 * h(1);
    const baseX = Math.sin(angle) * radial;
    const baseZ = Math.cos(angle) * radial;
    const dir = angle + (h(2) - 0.5) * 0.9; // куда клонится травинка
    const fx = Math.sin(dir);
    const fz = Math.cos(dir);
    const sx = fz; // поперёк направления клона
    const sz = -fx;
    // Центральная травинка выше остальных — пучок читается как «куст травы», а не веер.
    const height = i === 0 ? 0.42 + 0.07 * h(3) : 0.2 + 0.2 * h(3);
    const width = 0.05 + 0.03 * h(4);
    const lean = (0.1 + 0.28 * h(5)) * height;
    const tint = 0.88 + 0.22 * h(6);
    const dry = h(7) > 0.82; // изредка выгоревшая травинка
    const tip = scaleRgb(dry ? GRASS_DRY_TIP : GRASS_TIP, tint);
    const mid = scaleRgb(mixRgb(GRASS_MID, tip, 0.25), tint);
    const root = scaleRgb(GRASS_ROOT, tint);

    const base = positions.length / 3;
    const nx = fx * 0.3;
    const nz = fz * 0.3;
    const midY = height * 0.55;
    const midLean = lean * 0.3;
    pushVertex(baseX - (sx * width) / 2, 0, baseZ - (sz * width) / 2, nx, nz, root);
    pushVertex(baseX + (sx * width) / 2, 0, baseZ + (sz * width) / 2, nx, nz, root);
    pushVertex(baseX + fx * midLean - sx * width * 0.36, midY, baseZ + fz * midLean - sz * width * 0.36, nx, nz, mid);
    pushVertex(baseX + fx * midLean + sx * width * 0.36, midY, baseZ + fz * midLean + sz * width * 0.36, nx, nz, mid);
    pushVertex(baseX + fx * lean, height, baseZ + fz * lean, nx, nz, tip);
    indices.push(base, base + 1, base + 3, base, base + 3, base + 2, base + 2, base + 3, base + 4);
  }

  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.colors = colors;
  data.indices = indices;
  data.applyToMesh(mesh);
  mesh.material = grassMaterial(scene);
  mesh.isPickable = false;
  return mesh;
}

/** Параметры раскладки пучков вокруг одного сида. */
const PATCH_RADIUS = 0.34; // насколько далеко от точки сида отходит пучок (средний шаг между сидами ≈ 0.7 м)
const SCALE_JITTER = { min: 0.85, max: 1.15 };

/**
 * Цвет пучка: низкочастотный шум по миру делает «пятна» — густая сочная трава и
 * выгоревшие проплешины; мелкий хэш добавляет разброс от пучка к пучку.
 * Возвращается множитель к вершинным цветам (RGB).
 */
export function tuftTint(x: number, z: number, jitter: number): Rgb {
  const patch = valueNoise2(x * 0.11, z * 0.11, 3); // ячейка ≈ 9 м
  const dryness = Math.max(0, patch - 0.55) / 0.45; // 0..1 только в «сухих» пятнах
  const lush = 1 - 0.14 * (1 - patch);
  const v = lush * (0.92 + 0.16 * jitter);
  return [v * (1 + 0.2 * dryness), v * (1 + 0.04 * dryness), v * (1 - 0.42 * dryness)];
}

/**
 * Раскладывает пучки тонкими инстансами базового меша: каждый сид превращается в
 * `tuftsPerSeed` пучков, разбросанных вокруг его точки. Возвращает число пучков.
 * Буферы собираются целиком и отдаются движку одним вызовом (без сотен
 * thinInstanceAdd с перевыделением массива).
 */
export function scatterGrass(base: Mesh, points: readonly GrassPoint[], tuftsPerSeed: number): number {
  const total = points.length * tuftsPerSeed;
  if (total === 0) return 0;

  const matrices = new Float32Array(total * 16);
  const colors = new Float32Array(total * 4);
  const scale = new Vector3();
  const pos = new Vector3();
  const quat = new Quaternion();
  const m = new Matrix();

  let n = 0;
  for (const p of points) {
    const kx = Math.round(p.x * 100);
    const kz = Math.round(p.z * 100);
    for (let j = 0; j < tuftsPerSeed; j++) {
      const r = (k: number): number => hash01(kx, kz, j * 8 + k, TUFT_SEED);
      // Первый пучок — в самой точке сида, остальные — по кругу вокруг неё.
      const dist = j === 0 ? 0 : PATCH_RADIUS * (0.55 + 0.45 * r(0));
      const ang = r(1) * Math.PI * 2;
      const x = p.x + Math.sin(ang) * dist;
      const z = p.z + Math.cos(ang) * dist;
      const s = p.scale * (SCALE_JITTER.min + (SCALE_JITTER.max - SCALE_JITTER.min) * r(2));
      scale.set(s * (0.9 + 0.2 * r(3)), s, s * (0.9 + 0.2 * r(3)));
      pos.set(x, 0, z);
      Quaternion.RotationAxisToRef(Vector3.Up(), p.rot + r(4) * Math.PI * 2, quat);
      Matrix.ComposeToRef(scale, quat, pos, m);
      m.copyToArray(matrices, n * 16);

      const tint = tuftTint(x, z, r(5));
      colors[n * 4] = tint[0];
      colors[n * 4 + 1] = tint[1];
      colors[n * 4 + 2] = tint[2];
      colors[n * 4 + 3] = 1;
      n++;
    }
  }

  base.thinInstanceSetBuffer("matrix", matrices, 16, true);
  base.thinInstanceSetBuffer("instanceColor", colors, 4, true);
  base.thinInstanceRefreshBoundingInfo(true);
  return n;
}
