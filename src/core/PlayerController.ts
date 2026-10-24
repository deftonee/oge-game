import {
  Scene,
  Mesh,
  MeshBuilder,
  Vector3,
  StandardMaterial,
  Color3,
  TransformNode,
} from "@babylonjs/core";
import type { ActionId } from "../settings/settings";

/** Что игроку нужно от ввода: зажато ли действие движения (клавиши — в настройках, см. KeyBindings). */
export interface MovementInput {
  isDown(action: ActionId): boolean;
}

/** Размеры торса блочного персонажа (м) и высота его центра над ногами. */
const TORSO = { width: 0.7, height: 0.8, depth: 0.4, centerY: 1.0 } as const;

/**
 * Точка крепления на спине: начало координат — центр задней грани торса,
 * ось −z уходит НАЗАД от персонажа, +y вверх. Вешать на неё можно что угодно
 * (рюкзак, колчан…) — PlayerController про содержимое не знает.
 */
export interface BackMount {
  node: TransformNode;
  /** Размеры торса: по ним навесное подгоняет свой размер и ремни. */
  torso: { width: number; height: number; depth: number };
}

/**
 * Простой персонаж от третьего лица без физдвижка:
 * - коллайдер — невидимый бокс с checkCollisions + ellipsoid, двигаем через moveWithCollisions
 * - видимая модель — блочный человечек в стиле Roblox, гружёная только эстетически
 * - гравитация — наивная: каждый кадр тянем вниз, коллизии с полом останавливают падение
 */
export class PlayerController {
  public readonly collider: Mesh;
  /** Где у персонажа спина (дочерний узел визуала: поворачивается вместе с ним и прозрачнеет в кустах). */
  public readonly backMount: BackMount;
  private readonly visual: TransformNode;
  private readonly scene: Scene;
  private readonly moveSpeed = 6.5; // м/с
  private readonly gravity = -18;
  private verticalVelocity = 0;

  /** Заблокировать движение (например, во время боя) */
  public inputLocked = false;

  /** Вектор мобильного стика (нормированный, y=+1 вперёд). null — нет тач-управления. */
  private joystickVec: { x: number; y: number } | null = null;

  constructor(scene: Scene, spawnPosition: Vector3, private readonly input: MovementInput) {
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
    this.backMount = this.createBackMount();
    // Визуал центрируется на коллайдере: ноги модели (низ ног на y=0 в
    // локальных координатах модели) стоят ровно на полу, когда коллайдер
    // лежит на нём. Раньше визуал был опущен на -0.9 — персонаж наполовину
    // утопал в пол.
    this.visual.position = new Vector3(0, 0, 0);
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

    const torso = MeshBuilder.CreateBox("torso", { width: TORSO.width, height: TORSO.height, depth: TORSO.depth }, this.scene);
    torso.material = shirt;
    torso.position.y = TORSO.centerY;
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

  private createBackMount(): BackMount {
    const node = new TransformNode("backMount", this.scene);
    node.parent = this.visual;
    // Персонаж смотрит в +z, значит спина — в −z; узел стоит на середине задней грани торса.
    node.position.set(0, TORSO.centerY, -TORSO.depth / 2);
    return { node, torso: { width: TORSO.width, height: TORSO.height, depth: TORSO.depth } };
  }

  /** Курс, в который смотрит модель игрока (рад, 0 = +Z). */
  public get facingYaw(): number {
    return this.visual.rotation.y;
  }

  /** Мгновенно развернуть модель лицом к точке (в бою — к противнику). */
  public faceToward(x: number, z: number): void {
    this.visual.rotation.y = Math.atan2(x - this.collider.position.x, z - this.collider.position.z);
  }

  /** Задать вектор мобильного стика (нормированный, кадр-в-кадр). Нулевой вектор инертен. */
  public setJoystick(v: { x: number; y: number } | null): void {
    this.joystickVec = v;
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
      if (this.joystickVec) {
        moveDir = moveDir.add(forward.scale(this.joystickVec.y)).add(right.scale(this.joystickVec.x));
      }
      if (this.input.isDown("moveForward")) moveDir = moveDir.add(forward);
      if (this.input.isDown("moveBack")) moveDir = moveDir.subtract(forward);
      if (this.input.isDown("moveRight")) moveDir = moveDir.add(right);
      if (this.input.isDown("moveLeft")) moveDir = moveDir.subtract(right);
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

  /** Прозрачность модели игрока (1 — обычный, <1 — «спрятан в кусте»). Коллайдер не затрагивается. */
  public setVisualAlpha(alpha: number): void {
    for (const mesh of this.visual.getChildMeshes()) mesh.visibility = alpha;
  }
}
