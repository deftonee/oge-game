import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3 } from "@babylonjs/core";
import { CORRIDOR_WIDTH } from "../world/WorldGenerator";

const TIER_GLOW: Record<number, string> = {
  1: "#7be0c8",
  2: "#ffcf6b",
  3: "#c993ff",
};

/**
 * Энергетический барьер между секциями (по фидбэку): физически блокирует
 * проход (коллизия), пока не будет разрушен заклинанием нужного уровня —
 * см. GateManager. Требуемый тир растёт вместе с прогрессом по коридору.
 */
export class EnergyGate {
  private readonly barrier: Mesh;
  private readonly mat: StandardMaterial;
  public opened = false;

  constructor(scene: Scene, z: number, public readonly id: string, public readonly requiredTier: number) {
    this.mat = new StandardMaterial(`gateMat_${id}`, scene);
    const color = TIER_GLOW[requiredTier] ?? TIER_GLOW[3];
    this.mat.diffuseColor = Color3.FromHexString(color);
    this.mat.emissiveColor = Color3.FromHexString(color);
    this.mat.alpha = 0.38;
    this.mat.backFaceCulling = false;
    this.mat.specularColor = Color3.Black();

    this.barrier = MeshBuilder.CreateBox(
      `gateBarrier_${id}`,
      { width: CORRIDOR_WIDTH - 0.4, height: 4, depth: 0.3 },
      scene
    );
    this.barrier.material = this.mat;
    this.barrier.position.set(0, 2, z);
    this.barrier.checkCollisions = true;
  }

  public get position(): Vector3 {
    return this.barrier.position;
  }

  /** Разрушить барьер — открывает проход и убирает визуал. */
  public open(): void {
    this.opened = true;
    this.barrier.checkCollisions = false;
    this.barrier.setEnabled(false);
  }

  public dispose(): void {
    this.barrier.dispose();
    this.mat.dispose();
  }
}
