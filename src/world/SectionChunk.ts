import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3, Matrix, Quaternion } from "@babylonjs/core";
import { SectionSpec, ScatterSeed, BorderStyle, CORRIDOR_WIDTH } from "./WorldGenerator";
import { Witch } from "../entities/Witch";
import { Bonfire } from "../entities/Bonfire";
import { PracticeTarget } from "../entities/PracticeTarget";
import { EnergyGate } from "../entities/EnergyGate";
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
  public practiceTargets: PracticeTarget[] = [];
  public gate: EnergyGate | null = null;
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
    this.buildBorder(this.spec.borderLeft);
    this.buildBorder(this.spec.borderRight);

    for (const w of this.spec.witches) {
      const witch = new Witch(
        this.scene,
        new Vector3(w.x, 0, w.z),
        getSpellById(w.spellId),
        w.id,
        gameState.isWitchDefeated(w.id)
      );
      this.witches.push(witch);
      this.disposables.push(witch);
    }

    for (const b of this.spec.bonfires) {
      const bonfire = new Bonfire(this.scene, new Vector3(b.x, 0, b.z), b.id);
      this.bonfires.push(bonfire);
      this.disposables.push(bonfire);
    }

    for (const p of this.spec.practiceTargets) {
      const target = new PracticeTarget(this.scene, new Vector3(p.x, 0, p.z), p.id, p.kind);
      this.practiceTargets.push(target);
      this.disposables.push(target);
    }

    if (this.spec.gateAtStart && !gameState.isGateOpen(this.spec.gateAtStart.id)) {
      const g = this.spec.gateAtStart;
      const gate = new EnergyGate(this.scene, this.spec.startZ, g.id, g.requiredTier);
      this.gate = gate;
      this.disposables.push(gate);
    }
  }

  public dispose(): void {
    if (!this.built) return;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.witches = [];
    this.bonfires = [];
    this.practiceTargets = [];
    this.gate = null;
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
    wallMat.diffuseColor = Color3.FromHexString("#4a4d52");
    wallMat.specularColor = Color3.Black();
    const centerZ = (this.spec.startZ + this.spec.endZ) / 2;

    const left = MeshBuilder.CreateBox(
      `wallL_${this.spec.index}`,
      { width: 0.3, height: 2.5, depth: this.spec.length },
      this.scene
    );
    left.position.set(-CORRIDOR_WIDTH / 2, 1.25, centerZ);
    left.material = wallMat;
    left.checkCollisions = true;

    const right = left.clone(`wallR_${this.spec.index}`);
    right.position.x = CORRIDOR_WIDTH / 2;
    right.checkCollisions = true;

    this.disposables.push(left, right, wallMat);
  }

  /**
   * Трава — один меш-образец, все точки — тонкие инстансы (один draw call
   * на всю траву секции вместо сотен мешей).
   *
   * ВАЖНО: матрицы thinInstanceAdd умножаются на собственную мировую матрицу
   * базового меша ("the original mesh is the parent of the instances" —
   * подтверждено на форуме Babylon.js). Поэтому базовый меш обязан остаться
   * в identity-трансформе (позиция 0,0,0, без поворота/масштаба) — иначе
   * все инстансы получают двойное преобразование и улетают в случайные
   * точки далеко за пределы поля.
   */
  private buildScatter(seeds: ScatterSeed[], kind: "grass"): void {
    if (seeds.length === 0) return;

    const mat = new StandardMaterial(`${kind}Mat_${this.spec.index}`, this.scene);
    mat.diffuseColor = Color3.FromHexString("#5fae4a");
    mat.specularColor = Color3.Black();

    const base = MeshBuilder.CreateCylinder(
      `${kind}_${this.spec.index}`,
      { diameterTop: 0, diameterBottom: 0.18, height: 0.4 },
      this.scene
    );
    base.material = mat;
    this.scatterInstances(base, seeds, 0.2);
    this.disposables.push(base, mat);
  }

  /**
   * Граница коридора вместо плоской чёрной стены (по фидбэку) — случайный
   * стиль на секцию: густые кусты, металлический забор или скальная гряда.
   * Реальный коллайдер — тонкая невидимая-под-декором стена в buildWalls();
   * эти меши чисто декоративные, коллизий не имеют.
   */
  private buildBorder(seeds: ScatterSeed[]): void {
    if (seeds.length === 0) return;

    const side = seeds === this.spec.borderLeft ? "L" : "R";
    const style = this.spec.borderStyle;
    const mat = new StandardMaterial(`border${side}Mat_${this.spec.index}`, this.scene);

    let base;
    let baseY: number;
    if (style === "bushes") {
      mat.diffuseColor = Color3.FromHexString("#2f5b34");
      base = MeshBuilder.CreateSphere(`border${side}_${this.spec.index}`, { diameter: 1.1, segments: 6 }, this.scene);
      baseY = 0.45;
    } else if (style === "fence") {
      mat.diffuseColor = Color3.FromHexString("#8a8f98");
      base = MeshBuilder.CreateBox(`border${side}_${this.spec.index}`, { width: 0.12, height: 1.3, depth: 0.12 }, this.scene);
      baseY = 0.65;
    } else {
      mat.diffuseColor = Color3.FromHexString("#5c5347");
      base = MeshBuilder.CreateSphere(`border${side}_${this.spec.index}`, { diameter: 1.3, segments: 4 }, this.scene);
      baseY = 0.55;
    }
    mat.specularColor = Color3.Black();
    base.material = mat;

    this.scatterInstances(base, seeds, baseY);
    this.disposables.push(base, mat);
  }

  /** Общий хелпер: раскладывает сиды как тонкие инстансы заданного базового меша. */
  private scatterInstances(base: Mesh, seeds: ScatterSeed[], baseY: number): void {
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      const matrix = Matrix.Compose(
        new Vector3(s.scale, s.scale, s.scale),
        Quaternion.RotationAxis(Vector3.Up(), s.rot),
        new Vector3(s.x, baseY, s.z)
      );
      base.thinInstanceAdd(matrix, false);
    }
    base.thinInstanceRefreshBoundingInfo(true);
  }
}
