import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3 } from "@babylonjs/core";
import { getSchoolById } from "../data/spells";

const TIER_GLOW: Record<number, string> = {
  1: "#7be0c8",
  2: "#ffcf6b",
  3: "#c993ff",
};

export interface EnergyGateOptions {
  id: string;
  requiredSpells: number;
  /** Ветка прокачки (школа), к которой ведут ворота — задаёт цвет и тематику барьера. */
  schoolId: string | null;
  x: number;
  z: number;
  /** Ориентация барьера в мире (совпадает с yaw секции, на конце которой стоит). */
  yaw: number;
  /** Ширина барьера: вся секция, либо половина коридора при развилке. */
  width: number;
  /**
   * Ворота развилки: после открытия игрок может пройти ТОЛЬКО вперёд.
   * Сразу за барьером стоит невидимый коллайдер, который активируется,
   * когда игрок пересёк линию ворот и ушёл в ветку (dot > 1 м) — назад
   * вернуться невозможно (см. ТЗ про ветвление коридора).
   */
  fork?: boolean;
}

/**
 * Энергетический барьер между секциями (по фидбэку): физически блокирует
 * проход (коллизия), пока не будет разрушен заклинанием. Требуемое число
 * изученных тем растёт вместе с прогрессом по коридору — см. GateManager.
 *
 * Развилка: два барьера по половине коридора (x = ±width/4), каждый окрашен
 * в цвет своей ветки прокачки (школы) — выбор ворот = выбор ветки.
 */
export class EnergyGate {
  private readonly barrier: Mesh;
  private readonly mat: StandardMaterial;
  /** Невидимый односторонний блок ворот развилки (см. opts.fork). */
  private readonly oneWayBlock: Mesh | null;
  private oneWayArmed = false;
  public opened = false;

  constructor(
    scene: Scene,
    public readonly opts: EnergyGateOptions
  ) {
    this.mat = new StandardMaterial(`gateMat_${opts.id}`, scene);
    const color = opts.schoolId ? getSchoolById(opts.schoolId).color : TIER_GLOW[Math.min(opts.requiredSpells, 3)] ?? TIER_GLOW[3];
    this.mat.diffuseColor = Color3.FromHexString(color);
    this.mat.emissiveColor = Color3.FromHexString(color);
    this.mat.alpha = 0.38;
    this.mat.backFaceCulling = false;
    this.mat.specularColor = Color3.Black();

    this.barrier = MeshBuilder.CreateBox(
      `gateBarrier_${opts.id}`,
      { width: opts.width, height: 4, depth: 0.3 },
      scene
    );
    this.barrier.material = this.mat;
    this.barrier.rotation.y = opts.yaw;
    this.barrier.position.set(opts.x, 2, opts.z);
    this.barrier.checkCollisions = true;
    // Пометка для Babylon Inspector и console.scene: фильтр в дереве сцены
    // (mesh -> metadata) сразу выдаёт "что это за барьер", без раскопок по id.
    this.barrier.metadata = {
      kind: "gateBarrier",
      gateId: opts.id,
      schoolId: opts.schoolId,
      requiredSpells: opts.requiredSpells,
      fork: !!opts.fork,
      width: opts.width,
    };

    // Односторонний блок: существует заранее (невидимый), чтобы переживать
    // пересборку секции стримером, но с отключённой коллизией — включается
    // updateOneWay(), когда игрок действительно прошёл сквозь ворота.
    this.oneWayBlock = opts.fork
      ? (() => {
          const block = MeshBuilder.CreateBox(
            `gateOneWay_${opts.id}`,
            { width: opts.width + 0.4, height: 4, depth: 0.2 },
            scene
          );
          block.rotation.y = opts.yaw;
          block.position.set(opts.x, 2, opts.z);
          block.isVisible = false;
          block.checkCollisions = false;
          block.metadata = {
            kind: "gateOneWay",
            gateId: opts.id,
            schoolId: opts.schoolId,
            armed: false,
          };
          return block;
        })()
      : null;
  }

  public get id(): string {
    return this.opts.id;
  }

  public get schoolId(): string | null {
    return this.opts.schoolId;
  }

  public get requiredSpells(): number {
    return this.opts.requiredSpells;
  }

  public get position(): Vector3 {
    return this.barrier.position;
  }

  public get yaw(): number {
    return this.opts.yaw;
  }

  public get width(): number {
    return this.opts.width;
  }

  /** Разрушить барьер — открывает проход и убирает визуал. */
  public open(): void {
    this.opened = true;
    this.barrier.checkCollisions = false;
    this.barrier.setEnabled(false);
  }

  /**
   * Вызывается каждый кадр для активных ворот. Как только игрок пересёк
   * линию ворот вперёд (более чем на 1 м) — включается невидимый блок,
   * и вернуться в предыдущую секцию уже нельзя.
   */
  public updateOneWay(playerX: number, playerZ: number): void {
    if (!this.opts.fork || !this.opened || this.oneWayArmed || !this.oneWayBlock) return;
    const dx = playerX - this.position.x;
    const dz = playerZ - this.position.z;
    const dot = dx * Math.sin(this.opts.yaw) + dz * Math.cos(this.opts.yaw);
    if (dot > 1.0) {
      this.oneWayArmed = true;
      this.oneWayBlock.checkCollisions = true;
      // Синхронизируем пометку: в инспекторе сразу видно, почему блок внезапно
      // стал коллизионным (fork-развилка → однонаправленный запор).
      const meta = this.oneWayBlock.metadata as { armed: boolean } | null;
      if (meta) meta.armed = true;
    }
  }

  public dispose(): void {
    this.barrier.dispose();
    this.oneWayBlock?.dispose();
    this.mat.dispose();
  }
}