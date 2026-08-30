import {
  Scene,
  TransformNode,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  PointLight,
} from "@babylonjs/core";

/**
 * Костёр (п.3 ТЗ) — место, где игрок изучает новые заклинания. В отличие
 * от ведьм, встреча не начинается автоматически: игрок сам подходит и
 * нажимает E, чтобы "сесть" у костра.
 */
export class Bonfire {
  public readonly root: TransformNode;

  constructor(scene: Scene, position: Vector3, public readonly id: string) {
    this.root = this.buildModel(scene);
    this.root.position = position;
  }

  private buildModel(scene: Scene): TransformNode {
    const root = new TransformNode(`bonfire_${this.id}`, scene);

    const logMat = new StandardMaterial("logMat", scene);
    logMat.diffuseColor = Color3.FromHexString("#4a3524");

    const log1 = MeshBuilder.CreateBox("log1", { width: 1.4, height: 0.18, depth: 0.18 }, scene);
    log1.material = logMat;
    log1.rotation.y = Math.PI / 4;
    log1.position.y = 0.1;
    log1.parent = root;

    const log2 = log1.clone("log2");
    log2.rotation.y = -Math.PI / 4;
    log2.parent = root;

    const flameMat = new StandardMaterial("flameMat", scene);
    flameMat.diffuseColor = Color3.FromHexString("#ffb020");
    flameMat.emissiveColor = Color3.FromHexString("#ff8a3d");

    const flame = MeshBuilder.CreateCylinder("flame", { diameterTop: 0, diameterBottom: 0.45, height: 0.7 }, scene);
    flame.material = flameMat;
    flame.position.y = 0.45;
    flame.parent = root;

    const light = new PointLight("bonfireLight", new Vector3(0, 0.8, 0), scene);
    light.diffuse = Color3.FromHexString("#ffb020");
    light.intensity = 0.7;
    light.range = 7;
    light.parent = root;

    return root;
  }

  public get position(): Vector3 {
    return this.root.position;
  }

  public dispose(): void {
    this.root.dispose();
  }
}
