import {
  Color3,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

export interface OwlCompanionOptions {
  /** Позиция совы относительно игрока. */
  offset?: Vector3;
  /** Скорость, с которой сова догоняет целевую позицию. */
  followSpeed?: number;
  /** Высота полёта относительно игрока. */
  height?: number;
}

/**
 * Сова-помощник.
 *
 * Она не является частью WorldStreamer: её жизненный цикл принадлежит
 * игровому миру и она постоянно следует за игроком.
 */
export class OwlCompanion {
  public readonly root: TransformNode;
  private readonly target = new Vector3();
  private readonly offset: Vector3;
  private readonly followSpeed: number;
  private readonly height: number;
  private time = 0;

  constructor(
    private readonly scene: Scene,
    playerPosition: Vector3,
    options: OwlCompanionOptions = {},
  ) {
    this.offset = options.offset?.clone() ?? new Vector3(-1.6, 1.7, 1.4);
    this.followSpeed = options.followSpeed ?? 4.5;
    this.height = options.height ?? 1.7;
    this.root = this.buildModel();
    this.root.position.copyFrom(playerPosition).addInPlace(this.offset);
  }

  private buildModel(): TransformNode {
    const root = new TransformNode("owlCompanion", this.scene);

    const bodyMat = new StandardMaterial("owlBodyMat", this.scene);
    bodyMat.diffuseColor = Color3.FromHexString("#6a513f");
    bodyMat.specularColor = Color3.Black();

    const bellyMat = new StandardMaterial("owlBellyMat", this.scene);
    bellyMat.diffuseColor = Color3.FromHexString("#c5a982");
    bellyMat.specularColor = Color3.Black();

    const eyeMat = new StandardMaterial("owlEyeMat", this.scene);
    eyeMat.diffuseColor = Color3.FromHexString("#f4d35e");
    eyeMat.emissiveColor = Color3.FromHexString("#4a3d12");

    const body = MeshBuilder.CreateSphere(
      "owlBody",
      { diameter: 0.72, segments: 8 },
      this.scene,
    );
    body.scaling.y = 1.15;
    body.material = bodyMat;
    body.parent = root;

    const belly = MeshBuilder.CreateSphere(
      "owlBelly",
      { diameter: 0.48, segments: 8 },
      this.scene,
    );
    belly.position.z = -0.28;
    belly.material = bellyMat;
    belly.parent = root;

    const head = MeshBuilder.CreateSphere(
      "owlHead",
      { diameter: 0.62, segments: 8 },
      this.scene,
    );
    head.position.y = 0.48;
    head.material = bodyMat;
    head.parent = root;

    for (const x of [-0.17, 0.17]) {
      const eye = MeshBuilder.CreateSphere(
        "owlEye",
        { diameter: 0.13, segments: 6 },
        this.scene,
      );
      eye.position.set(x, 0.53, -0.27);
      eye.material = eyeMat;
      eye.parent = root;
    }

    for (const x of [-0.43, 0.43]) {
      const wing = MeshBuilder.CreateSphere(
        "owlWing",
        { diameter: 0.38, segments: 6 },
        this.scene,
      );
      wing.scaling.set(0.65, 1.35, 0.5);
      wing.position.set(x, 0.02, 0);
      wing.rotation.z = x < 0 ? -0.25 : 0.25;
      wing.material = bodyMat;
      wing.parent = root;
    }

    root.metadata = { kind: "owlCompanion" };
    return root;
  }

  /**
   * Вызывай один раз за кадр после обновления позиции игрока.
   * deltaTime — секунды между кадрами.
   */
  public update(deltaTime: number, playerPosition: Vector3): void {
    this.time += Math.max(0, deltaTime);

    this.target.copyFrom(playerPosition);
    this.target.x += this.offset.x;
    this.target.z += this.offset.z;
    this.target.y += this.height + Math.sin(this.time * 3.0) * 0.12;

    const factor = 1 - Math.exp(-this.followSpeed * Math.max(0, deltaTime));
    Vector3.LerpToRef(this.root.position, this.target, factor, this.root.position);

    // Лёгкое покачивание крыльев/тела делает сову визуально "живой"
    // даже без отдельной AnimationGroup.
    this.root.rotation.z = Math.sin(this.time * 4.5) * 0.04;
    this.root.rotation.y = Math.sin(this.time * 1.4) * 0.08;
  }

  public dispose(): void {
    this.root.dispose();
  }
}
