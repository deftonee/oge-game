import {
  Color3,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

export interface OwlCompanionOptions {
  /** Радиус орбиты вокруг игрока (м). */
  orbitRadius?: number;
  /** Скорость облёта (рад/с). */
  orbitSpeed?: number;
  /** Высота полёта над точкой спавна игрока (м) — над головой. */
  height?: number;
  /** Скорость, с которой сова догоняет целевую позицию. */
  followSpeed?: number;
}

/**
 * Сова-помощник. Летает по круговой орбите над головой игрока.
 *
 * Не является частью WorldStreamer: её жизненный цикл принадлежит
 * игровому миру, она постоянно следует за игроком. В update() передаём
 * текущую позицию игрока и deltaTime — сова вычисляет целевую точку на
 * орбите и плавно (exponential lerp) догоняет её, плюс лёгкий bank/bob
 * делают её визуально живой без отдельной AnimationGroup.
 */
export class OwlCompanion {
  public readonly root: TransformNode;
  private readonly orbitRadius: number;
  private readonly orbitSpeed: number;
  private readonly height: number;
  private readonly followSpeed: number;
  private readonly target = new Vector3();
  private angle: number;
  private time = 0;

  constructor(
    private readonly scene: Scene,
    playerPosition: Vector3,
    options: OwlCompanionOptions = {},
  ) {
    this.orbitRadius = options.orbitRadius ?? 1.4;
    this.orbitSpeed = options.orbitSpeed ?? 1.6;
    this.height = options.height ?? 2.1;
    this.followSpeed = options.followSpeed ?? 6.0;
    // Стартовый угол — чтобы сова появилась СЗАДИ-сбоку, а не ровно в лицо.
    this.angle = Math.PI * 0.8;

    this.root = this.buildModel();
    this.root.position.copyFrom(playerPosition).addInPlace(new Vector3(
      Math.cos(this.angle) * this.orbitRadius,
      this.height,
      Math.sin(this.angle) * this.orbitRadius,
    ));
    // Смотрим вдоль вектора полёта по касательной к орбите.
    this.root.rotation.y = Math.PI - this.angle;
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
   * Вызывай каждый кадр после обновления позиции игрока.
   * deltaTime — секунды между кадрами.
   */
  public update(deltaTime: number, playerPosition: Vector3): void {
    this.time += Math.max(0, deltaTime);
    this.angle += this.orbitSpeed * Math.max(0, deltaTime);
    if (this.angle > Math.PI * 2) this.angle -= Math.PI * 2;

    const bob = Math.sin(this.time * 3.0) * 0.12;
    this.target.set(
      playerPosition.x + Math.cos(this.angle) * this.orbitRadius,
      playerPosition.y + this.height + bob,
      playerPosition.z + Math.sin(this.angle) * this.orbitRadius,
    );

    // Плавная погоня за целевой точкой орбиты — без рывков при телепортах.
    const factor = 1 - Math.exp(-this.followSpeed * Math.max(0, deltaTime));
    Vector3.LerpToRef(this.root.position, this.target, factor, this.root.position);

    // Сова смотрит вдоль касательной к орбите; лёгкое покачивание крыльев.
    this.root.rotation.y = Math.PI - this.angle;
    this.root.rotation.z = Math.sin(this.time * 4.5) * 0.04;
  }

  public dispose(): void {
    this.root.dispose();
  }
}
