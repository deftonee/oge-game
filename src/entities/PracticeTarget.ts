import {
  Scene,
  TransformNode,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
} from "@babylonjs/core";
import { PracticeTargetKind } from "../world/WorldGenerator";

/**
 * Статический объект для отработки заклинаний вне боя —
 * деревце, чучело или крапива. Чисто декоративная модель + точка
 * взаимодействия; сама логика тренировки — в PracticeManager.
 */
export class PracticeTarget {
  public readonly root: TransformNode;

  constructor(scene: Scene, position: Vector3, public readonly id: string, public readonly kind: PracticeTargetKind) {
    this.root = this.buildModel(scene);
    this.root.position = position;
  }

  private buildModel(scene: Scene): TransformNode {
    const root = new TransformNode(`practice_${this.id}`, scene);

    if (this.kind === "tree") {
      const trunkMat = new StandardMaterial("trunkMat", scene);
      trunkMat.diffuseColor = Color3.FromHexString("#6b4a2f");
      trunkMat.specularColor = Color3.Black();
      const trunk = MeshBuilder.CreateCylinder("trunk", { diameterTop: 0.15, diameterBottom: 0.22, height: 1.1 }, scene);
      trunk.material = trunkMat;
      trunk.position.y = 0.55;
      trunk.parent = root;

      const canopyMat = new StandardMaterial("canopyMat", scene);
      canopyMat.diffuseColor = Color3.FromHexString("#3f8a4a");
      canopyMat.specularColor = Color3.Black();
      const canopy = MeshBuilder.CreateSphere("canopy", { diameter: 1.1, segments: 6 }, scene);
      canopy.material = canopyMat;
      canopy.position.y = 1.5;
      canopy.parent = root;
    } else if (this.kind === "dummy") {
      const postMat = new StandardMaterial("postMat", scene);
      postMat.diffuseColor = Color3.FromHexString("#7a6a52");
      postMat.specularColor = Color3.Black();
      const post = MeshBuilder.CreateCylinder("post", { diameter: 0.14, height: 1.6 }, scene);
      post.material = postMat;
      post.position.y = 0.8;
      post.parent = root;

      const strawMat = new StandardMaterial("strawMat", scene);
      strawMat.diffuseColor = Color3.FromHexString("#c9a24a");
      strawMat.specularColor = Color3.Black();
      const torso = MeshBuilder.CreateBox("torso", { width: 0.55, height: 0.7, depth: 0.35 }, scene);
      torso.material = strawMat;
      torso.position.y = 1.25;
      torso.parent = root;

      const arms = MeshBuilder.CreateBox("arms", { width: 1.1, height: 0.16, depth: 0.16 }, scene);
      arms.material = postMat;
      arms.position.y = 1.5;
      arms.parent = root;

      const head = MeshBuilder.CreateSphere("head", { diameter: 0.32 }, scene);
      head.material = strawMat;
      head.position.y = 1.85;
      head.parent = root;
    } else {
      const nettleMat = new StandardMaterial("nettleMat", scene);
      nettleMat.diffuseColor = Color3.FromHexString("#3a6b2f");
      nettleMat.specularColor = Color3.Black();
      // Крапива — кластер острых конусов чуть разной высоты
      const offsets: [number, number, number][] = [
        [0, 0.4, 0],
        [0.15, 0.32, 0.1],
        [-0.15, 0.28, -0.08],
        [0.05, 0.36, -0.15],
      ];
      for (const [ox, h, oz] of offsets) {
        const spike = MeshBuilder.CreateCylinder("spike", { diameterTop: 0, diameterBottom: 0.16, height: h }, scene);
        spike.material = nettleMat;
        spike.position.set(ox, h / 2, oz);
        spike.parent = root;
      }
    }

    return root;
  }

  public get position(): Vector3 {
    return this.root.position;
  }

  public dispose(): void {
    this.root.dispose();
  }
}
