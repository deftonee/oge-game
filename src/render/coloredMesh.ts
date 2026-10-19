import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, VertexBuffer } from "@babylonjs/core";
import { perScene } from "./perScene";

/**
 * «Дешёвая» раскраска геометрии: цвет хранится в вершинах, поэтому всё, что
 * на нём построено (кусты, кроны, трава, рюкзак, книги), использует ОДИН общий
 * материал на сцену. Это меньше переключений состояния GPU, меньше материалов в
 * памяти и никаких текстур; а градиент «тёмный низ → светлый верх» даёт
 * псевдо-затенение листвы без единого дополнительного источника света.
 */

export type Rgb = readonly [number, number, number];

/** Цвет в вершину: получает позицию вершины в локальных координатах меша. */
export type ColorFn = (x: number, y: number, z: number) => Rgb;

export function rgb(hex: string): Rgb {
  const c = Color3.FromHexString(hex);
  return [c.r, c.g, c.b];
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scaleRgb(c: Rgb, k: number): Rgb {
  return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
}

/** Матовый материал под вершинные цвета; один на сцену. Освобождается вместе со сценой. */
export const vertexColorMaterial = perScene((scene) => {
  const mat = new StandardMaterial("vertexColorMat", scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = Color3.Black();
  return mat;
});

/** Красит вершины меша функцией цвета (альфа всегда 1). */
export function paintMesh(mesh: Mesh, colorAt: ColorFn): void {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  if (!positions) return;
  const count = positions.length / 3;
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const [r, g, b] = colorAt(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    colors[i * 4] = r;
    colors[i * 4 + 1] = g;
    colors[i * 4 + 2] = b;
    colors[i * 4 + 3] = 1;
  }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
}

/** Вертикальный градиент по локальной Y: bottom на y0, top на y1 (за пределами — зажимается). */
export function verticalGradient(bottom: Rgb, top: Rgb, y0: number, y1: number): ColorFn {
  const span = y1 - y0 || 1;
  return (_x, y) => mixRgb(bottom, top, Math.max(0, Math.min(1, (y - y0) / span)));
}

/**
 * Сливает уже раскрашенные меши в один (один draw call). Источники уничтожаются.
 * Все части обязаны иметь одинаковый набор вершинных данных — поэтому красим ДО слияния.
 */
export function mergeColored(name: string, parts: Mesh[], scene: Scene): Mesh {
  const merged = parts.length > 1 ? Mesh.MergeMeshes(parts, true, true) : parts[0];
  if (!merged) throw new Error(`mergeColored(${name}): слияние не удалось`);
  merged.name = name;
  merged.material = vertexColorMaterial(scene);
  merged.isPickable = false;
  return merged;
}

/** Часть из бокса: размеры, центр, поворот вокруг Z/Y (рад) и цвет. */
export interface BoxPart {
  size: readonly [number, number, number];
  pos: readonly [number, number, number];
  rotZ?: number;
  rotY?: number;
  color: Rgb | ColorFn;
}

/** Один меш из набора раскрашенных боксов (ремни, обложки, пряжки…). */
export function buildColoredBoxes(name: string, parts: readonly BoxPart[], scene: Scene): Mesh {
  const boxes = parts.map((p, i) => {
    const box = MeshBuilder.CreateBox(`${name}_part${i}`, { width: p.size[0], height: p.size[1], depth: p.size[2] }, scene);
    box.position.set(p.pos[0], p.pos[1], p.pos[2]);
    box.rotation.z = p.rotZ ?? 0;
    box.rotation.y = p.rotY ?? 0;
    // Позиция/поворот должны попасть в вершины: иначе слияние их «потеряет».
    box.bakeCurrentTransformIntoVertices();
    const color = p.color;
    paintMesh(box, typeof color === "function" ? color : () => color);
    return box;
  });
  return mergeColored(name, boxes, scene);
}
