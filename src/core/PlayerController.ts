import {
  Scene,
  Mesh,
  MeshBuilder,
  Vector3,
  StandardMaterial,
  Color3,
  TransformNode,
} from "@babylonjs/core";

/**
 * Простой персонаж от третьего лица без физдвижка:
 * - коллайдер — невидимый бокс с checkCollisions + ellipsoid, двигаем через moveWithCollisions
 * - видимая модель — блочный человечек в стиле Roblox, гружёная только эстетически
 * - гравитация — наивная: каждый кадр тянем вниз, коллизии с полом останавливают падение
 */
export class PlayerController {
  public readonly collider: Mesh;
  private readonly visual: TransformNode;
  private readonly scene: Scene;
  private readonly inputMap: Record<string, boolean> = {};
  private readonly moveSpeed = 6.5; // м/с
  private readonly gravity = -18;
  private verticalVelocity = 0;

  /** Заблокировать движение (например, во время боя) */
  public inputLocked = false;

  constructor(scene: Scene, spawnPosition: Vector3) {
    this.scene = scene;

    // Коллайдер персонажа
    this.collider = MeshBuilder.CreateBox("playerCollider", { width: 0.8, height: 1.8, depth: 0.8 }, scene);
    this.collider.position = spawnPosition.clone();
    this.collider.isVisible = false;
    this.collider.checkCollisions = true;
    this.collider.ellipsoid = new Vector3(0.4, 0.9, 0.4);
    this.collider.ellipsoidOffset = new Vector3(0, 0.9, 0);

    this.visual = this.buildBlockyCharacter();
    this.visual.parent = this.collider;
    this.visual.position = new Vector3(0, -0.9, 0);

    this.setupInput();
  }

  private buildBlockyCharacter(): TransformNode {
    const root = new TransformNode("playerVisual", this.scene);

    const skin = new StandardMaterial("skinMat", this.scene);
    skin.diffuseColor = Color3.FromHexString("#ffd08a");

    const shirt = new StandardMaterial("shirtMat", this.scene);
    shirt.diffuseColor = Color3.FromHexString("#4fd6c8");

    const pants = new StandardMaterial("pantsMat", this.scene);
    pants.diffuseColor = Color3.FromHexString("#2c3455");

    const head = MeshBuilder.CreateBox("head", { size: 0.5 }, this.scene);
    head.material = skin;
    head.position.y = 1.55;
    head.parent = root;

    const torso = MeshBuilder.CreateBox("torso", { width: 0.7, height: 0.8, depth: 0.4 }, this.scene);
    torso.material = shirt;
    torso.position.y = 1.0;
    torso.parent = root;

    const legL = MeshBuilder.CreateBox("legL", { width: 0.3, height: 0.8, depth: 0.35 }, this.scene);
    legL.material = pants;
    legL.position.set(-0.2, 0.4, 0);
    legL.parent = root;

    const legR = legL.clone("legR");
    legR.position.x = 0.2;
    legR.parent = root;

    const armL = MeshBuilder.CreateBox("armL", { width: 0.25, height: 0.75, depth: 0.25 }, this.scene);
    armL.material = shirt;
    armL.position.set(-0.5, 1.0, 0);
    armL.parent = root;

    const armR = armL.clone("armR");
    armR.position.x = 0.5;
    armR.parent = root;

    return root;
  }

  private setupInput(): void {
    window.addEventListener("keydown", (e) => {
      this.inputMap[e.key.toLowerCase()] = true;
    });
    window.addEventListener("keyup", (e) => {
      this.inputMap[e.key.toLowerCase()] = false;
    });
  }

  /**
   * Вызывается каждый кадр. cameraForward/cameraRight — мировые направления камеры
   * (например camera.getDirection(Vector3.Forward()/Right())), их спроецируем на XZ сами.
   */
  public update(deltaSeconds: number, cameraForward: Vector3, cameraRight: Vector3): void {
    const forward = cameraForward.clone();
    forward.y = 0;
    forward.normalize();
    const right = cameraRight.clone();
    right.y = 0;
    right.normalize();

    let moveDir = Vector3.Zero();
    if (!this.inputLocked) {
      if (this.inputMap["w"] || this.inputMap["arrowup"]) moveDir = moveDir.add(forward);
      if (this.inputMap["s"] || this.inputMap["arrowdown"]) moveDir = moveDir.subtract(forward);
      if (this.inputMap["d"] || this.inputMap["arrowright"]) moveDir = moveDir.add(right);
      if (this.inputMap["a"] || this.inputMap["arrowleft"]) moveDir = moveDir.subtract(right);
    }

    if (moveDir.lengthSquared() > 0) {
      moveDir.normalize();
      // Разворачиваем модель персонажа лицом по направлению движения
      const targetYaw = Math.atan2(moveDir.x, moveDir.z);
      this.visual.rotation.y = this.lerpAngle(this.visual.rotation.y, targetYaw, 0.25);
    }

    // Наивная гравитация: пока не касаемся пола — падаем
    this.verticalVelocity += this.gravity * deltaSeconds;
    if (this.verticalVelocity < -20) this.verticalVelocity = -20;

    const displacement = moveDir
      .scale(this.moveSpeed * deltaSeconds)
      .add(new Vector3(0, this.verticalVelocity * deltaSeconds, 0));

    this.collider.moveWithCollisions(displacement);

    // Если уперлись в пол (вертикальная скорость гасится коллизией) — сбрасываем разгон падения
    if (this.collider.position.y < 1.01) {
      this.verticalVelocity = 0;
    }
  }

  private lerpAngle(from: number, to: number, t: number): number {
    let diff = to - from;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return from + diff * t;
  }

  public get position(): Vector3 {
    return this.collider.position;
  }
}
