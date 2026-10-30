import { MeshBuilder, StandardMaterial, Color3, TransformNode } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";

/** Размеры торса блочного персонажа (м) и высота его центра над ногами. */
export const TORSO = { width: 0.7, height: 0.8, depth: 0.4, centerY: 1.0 } as const;

/** Высота тазобедренных суставов над ступнями (м): вокруг этой точки наклоняется торс и качаются ноги. */
export const HIP_Y = 0.8;

/**
 * Шарниры блочного персонажа. Каждая конечность — меш внутри узла-шарнира (плечо, бедро, шея):
 * крутим узел, а не меш, поэтому рука или нога качается вокруг сустава, а не вокруг своего центра.
 *
 * Иерархия (курс персонажа задаёт родитель rig.root, он же — визуал игрока):
 *   root (курс) → body (сдвиг по высоте и поворот всего тела) → legL, legR
 *                                                              → torso (наклон вокруг таза) → head, armL, armR, рюкзак
 *
 * В позе покоя все повороты нулевые, и меши стоят ровно там же, где стояли у «неподвижной» модели.
 * Углы (рад): у рук и ног отрицательный rotation.x — вперёд (−π — вертикально вверх); у торса и головы
 * положительный rotation.x — наклон вперёд; у правой руки rotation.z > 0 — в сторону (у левой — наоборот).
 */
export interface PlayerRig {
  readonly root: TransformNode;
  readonly body: TransformNode;
  readonly torso: TransformNode;
  readonly head: TransformNode;
  readonly armL: TransformNode;
  readonly armR: TransformNode;
  readonly legL: TransformNode;
  readonly legR: TransformNode;
}

function node(name: string, scene: Scene, parent: TransformNode, x: number, y: number, z: number): TransformNode {
  const n = new TransformNode(name, scene);
  n.parent = parent;
  n.position.set(x, y, z);
  return n;
}

/** Строит блочного человечка (стиль Roblox) на переданном корне и возвращает его шарниры. */
export function buildPlayerRig(scene: Scene, root: TransformNode): PlayerRig {
  const skin = new StandardMaterial("skinMat", scene);
  skin.diffuseColor = Color3.FromHexString("#ffd08a");

  const shirt = new StandardMaterial("shirtMat", scene);
  shirt.diffuseColor = Color3.FromHexString("#4fd6c8");

  const pants = new StandardMaterial("pantsMat", scene);
  pants.diffuseColor = Color3.FromHexString("#2c3455");

  const body = node("playerBody", scene, root, 0, 0, 0);
  // Торс наклоняется вокруг таза, поэтому его узел стоит в точке таза, а всё внутри сдвинуто вниз на HIP_Y.
  const torso = node("playerTorso", scene, body, 0, HIP_Y, 0);

  const torsoMesh = MeshBuilder.CreateBox("torso", { width: TORSO.width, height: TORSO.height, depth: TORSO.depth }, scene);
  torsoMesh.material = shirt;
  torsoMesh.position.y = TORSO.centerY - HIP_Y;
  torsoMesh.parent = torso;

  // Шея: нижняя грань головы (центр 1.55, сторона 0.5 → низ на 1.30).
  const head = node("playerHead", scene, torso, 0, 1.3 - HIP_Y, 0);
  const headMesh = MeshBuilder.CreateBox("head", { size: 0.5 }, scene);
  headMesh.material = skin;
  headMesh.position.y = 0.25;
  headMesh.parent = head;

  // Плечи: верх руки (центр 1.0, высота 0.75 → верх на 1.375).
  const shoulderY = 1.375 - HIP_Y;
  const armL = node("playerArmL", scene, torso, -0.5, shoulderY, 0);
  const armR = node("playerArmR", scene, torso, 0.5, shoulderY, 0);
  for (const [pivot, name] of [[armL, "armL"], [armR, "armR"]] as const) {
    const mesh = MeshBuilder.CreateBox(name, { width: 0.25, height: 0.75, depth: 0.25 }, scene);
    mesh.material = shirt;
    mesh.position.y = -0.375;
    mesh.parent = pivot;
  }

  // Бёдра: верх ноги (центр 0.4, высота 0.8 → верх на 0.8). Ноги не наклоняются вместе с торсом.
  const legL = node("playerLegL", scene, body, -0.2, HIP_Y, 0);
  const legR = node("playerLegR", scene, body, 0.2, HIP_Y, 0);
  for (const [pivot, name] of [[legL, "legL"], [legR, "legR"]] as const) {
    const mesh = MeshBuilder.CreateBox(name, { width: 0.3, height: 0.8, depth: 0.35 }, scene);
    mesh.material = pants;
    mesh.position.y = -0.4;
    mesh.parent = pivot;
  }

  return { root, body, torso, head, armL, armR, legL, legR };
}
