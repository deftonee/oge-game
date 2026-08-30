import { Scene, MeshBuilder, StandardMaterial, Color3, Vector3, Matrix, Quaternion } from "@babylonjs/core";
import { SectionSpec, ScatterSeed, CORRIDOR_WIDTH } from "./WorldGenerator";
import { Witch } from "../entities/Witch";
import { Bonfire } from "../entities/Bonfire";
import { getSpellById } from "../data/spells";
import { GameState } from "../core/GameState";

/**
 * Один "чанк" мира — пол, стены, трава, кусты, ведьмы и костры одной секции.
 * build()/dispose() полностью создают и полностью разбирают всю геометрию —
 * это и есть потоковая загрузка "только текущая секция в памяти" (см. ТЗ).
 * Побеждённые ведьмы (gameState.isWitchDefeated) при пересборке не создаются заново.
 */
export class SectionChunk {
  public witches: Witch[] = [];
  public bonfires: Bonfire[] = [];
  private built = false;
  private disposables: { dispose(): void }[] = [];

  constructor(private scene: Scene, public readonly spec: SectionSpec) {}

  public get isBuilt(): boolean {
    return this.built;
  }

  public build(gameState: GameState): void {
    if (this.built) return;
    this.built = true;

    this.buildFloor();
    this.buildWalls();
    this.buildScatter(this.spec.grass, "grass");
    this.buildScatter(this.spec.bushesLeft, "bushL");
    this.buildScatter(this.spec.bushesRight, "bushR");

    for (const w of this.spec.witches) {
      if (gameState.isWitchDefeated(w.id)) continue;
      const witch = new Witch(this.scene, new Vector3(w.x, 0, w.z), getSpellById(w.spellId), w.id);
      this.witches.push(witch);
      this.disposables.push(witch);
    }

    for (const b of this.spec.bonfires) {
      const bonfire = new Bonfire(this.scene, new Vector3(b.x, 0, b.z), b.id);
      this.bonfires.push(bonfire);
      this.disposables.push(bonfire);
    }
  }

  public dispose(): void {
    if (!this.built) return;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.witches = [];
    this.bonfires = [];
    this.built = false;
  }

  private buildFloor(): void {
    const floor = MeshBuilder.CreateGround(
      `floor_${this.spec.index}`,
      { width: CORRIDOR_WIDTH, height: this.spec.length },
      this.scene
    );
    const mat = new StandardMaterial(`floorMat_${this.spec.index}`, this.scene);
    mat.diffuseColor = Color3.FromHexString(this.spec.color);
    mat.specularColor = Color3.Black();
    floor.material = mat;
    floor.position.set(0, 0, (this.spec.startZ + this.spec.endZ) / 2);
    floor.checkCollisions = true;
    this.disposables.push(floor, mat);
  }

  private buildWalls(): void {
    const wallMat = new StandardMaterial(`wallMat_${this.spec.index}`, this.scene);
    wallMat.diffuseColor = Color3.FromHexString("#0c0e18");
    const centerZ = (this.spec.startZ + this.spec.endZ) / 2;

    const left = MeshBuilder.CreateBox(
      `wallL_${this.spec.index}`,
      { width: 0.5, height: 3, depth: this.spec.length },
      this.scene
    );
    left.position.set(-CORRIDOR_WIDTH / 2, 1.5, centerZ);
    left.material = wallMat;
    left.checkCollisions = true;

    const right = left.clone(`wallR_${this.spec.index}`);
    right.position.x = CORRIDOR_WIDTH / 2;
    right.checkCollisions = true;

    this.disposables.push(left, right, wallMat);
  }

  /**
   * Трава/кусты — по одному мешу-образцу на группу, дальше все точки — тонкие
   * инстансы (один draw call на всю траву секции вместо сотен мешей). Сам
   * образец ставится в позицию первого сида, чтобы не оставалось "лишнего"
   * экземпляра в начале координат.
   */
  private buildScatter(seeds: ScatterSeed[], kind: "grass" | "bushL" | "bushR"): void {
    if (seeds.length === 0) return;

    const isGrass = kind === "grass";
    const mat = new StandardMaterial(`${kind}Mat_${this.spec.index}`, this.scene);
    mat.diffuseColor = Color3.FromHexString(isGrass ? "#5fae4a" : "#2f5b34");
    mat.specularColor = Color3.Black();

    const base = isGrass
      ? MeshBuilder.CreateCylinder(`${kind}_${this.spec.index}`, { diameterTop: 0, diameterBottom: 0.18, height: 0.4 }, this.scene)
      : MeshBuilder.CreateSphere(`${kind}_${this.spec.index}`, { diameter: 0.9, segments: 6 }, this.scene);
    base.material = mat;

    const baseY = isGrass ? 0.2 : 0.4;
    const first = seeds[0];
    base.position.set(first.x, baseY, first.z);
    base.rotation.y = first.rot;
    base.scaling.setAll(first.scale);

    for (let i = 1; i < seeds.length; i++) {
      const s = seeds[i];
      const matrix = Matrix.Compose(
        new Vector3(s.scale, s.scale, s.scale),
        Quaternion.RotationAxis(Vector3.Up(), s.rot),
        new Vector3(s.x, baseY, s.z)
      );
      base.thinInstanceAdd(matrix, false);
    }
    base.thinInstanceRefreshBoundingInfo(true);

    this.disposables.push(base, mat);
  }
}
