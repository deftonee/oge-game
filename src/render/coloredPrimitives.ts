import { Mesh, MeshBuilder, Scene } from "@babylonjs/core";
import { mergeColored, paintMesh, type ColorFn, type Rgb } from "./coloredMesh";

/**
 * Модели из цветных примитивов: бокс, цилиндр (в т.ч. конус), сфера, тор — в один
 * меш с цветом в вершинах (один draw call, общий материал на сцену, см.
 * coloredMesh.ts). Дополняет buildColoredBoxes, где есть только боксы.
 *
 * Все координаты частей — в системе МОДЕЛИ (центр части, метры; y вверх), поворот —
 * углы Эйлера (рад). Преобразование «запекается» в вершины до слияния, поэтому
 * готовый меш сразу годится как шаблон для instances/clone.
 *
 * Цилиндр и тор по умолчанию стоят вертикально (ось Y); чтобы уложить на бок,
 * поверните вокруг Z (вдоль X) или X (вдоль Z).
 */

interface PartBase {
  pos: readonly [number, number, number];
  /** Эйлеровы углы (рад): rotX, rotY, rotZ. */
  rot?: readonly [number, number, number];
  color: Rgb | ColorFn;
}

export type PrimitivePart =
  | (PartBase & { shape: "box"; size: readonly [number, number, number] })
  | (PartBase & { shape: "cylinder"; diameter: number; height: number; diameterTop?: number; sides?: number })
  | (PartBase & { shape: "sphere"; diameter: number; segments?: number })
  | (PartBase & { shape: "torus"; diameter: number; thickness: number; tessellation?: number });

function createPart(name: string, part: PrimitivePart, scene: Scene): Mesh {
  switch (part.shape) {
    case "box":
      return MeshBuilder.CreateBox(name, { width: part.size[0], height: part.size[1], depth: part.size[2] }, scene);
    case "cylinder":
      return MeshBuilder.CreateCylinder(
        name,
        {
          diameterBottom: part.diameter,
          diameterTop: part.diameterTop ?? part.diameter,
          height: part.height,
          tessellation: part.sides ?? 8,
        },
        scene
      );
    case "sphere":
      return MeshBuilder.CreateSphere(name, { diameter: part.diameter, segments: part.segments ?? 6 }, scene);
    case "torus":
      return MeshBuilder.CreateTorus(
        name,
        { diameter: part.diameter, thickness: part.thickness, tessellation: part.tessellation ?? 12 },
        scene
      );
  }
}

/** Один меш из набора раскрашенных примитивов. Материал — общий вершинный (vertexColorMaterial). */
export function buildColoredPrimitives(name: string, parts: readonly PrimitivePart[], scene: Scene): Mesh {
  const meshes = parts.map((p, i) => {
    const mesh = createPart(`${name}_part${i}`, p, scene);
    mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
    if (p.rot) mesh.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
    // Позиция/поворот должны попасть в вершины: иначе слияние их «потеряет».
    mesh.bakeCurrentTransformIntoVertices();
    const color = p.color;
    paintMesh(mesh, typeof color === "function" ? color : () => color);
    return mesh;
  });
  return mergeColored(name, meshes, scene);
}
