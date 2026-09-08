import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3, Matrix, Quaternion } from "@babylonjs/core";
import { SectionSpec, ScatterSeed, BorderStyle, localToWorld } from "./WorldGenerator";
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
 *
 * Секция лежит в собственной локальной системе координат (x — поперёк,
 * z — вдоль коридора), повёрнутой в мире на spec.yaw: все сущности и декор
 * из spec заданы в локальных координатах и переводятся в мировые здесь.
 * На стыке изогнутых секций ставится диск-заплатка, закрывающий зазор пола.
 * Выходные ворота (spec.gates) стоят на КОНЦЕ секции.
 */
export class SectionChunk {
  public witches: Witch[] = [];
  public bonfires: Bonfire[] = [];
  public practiceTargets: PracticeTarget[] = [];
  /** Выходные ворота секции (0..2 — при развилке оба барьера активны). */
  public gates: EnergyGate[] = [];
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
    this.buildPartition();
    this.buildJointPatch();
    this.buildScatter(this.spec.grass, "grass");
    this.buildBorder(this.spec.borderLeft);
    this.buildBorder(this.spec.borderRight);

    for (const w of this.spec.witches) {
      const pos = this.toWorld(w.x, w.z);
      const witch = new Witch(
        this.scene,
        new Vector3(pos.x, 0, pos.z),
        getSpellById(w.spellId),
        w.id,
        gameState.isWitchDefeated(w.id)
      );
      this.witches.push(witch);
      this.disposables.push(witch);
    }

    for (const b of this.spec.bonfires) {
      const pos = this.toWorld(b.x, b.z);
      const bonfire = new Bonfire(this.scene, new Vector3(pos.x, 0, pos.z), b.id);
      this.bonfires.push(bonfire);
      this.disposables.push(bonfire);
    }

    for (const p of this.spec.practiceTargets) {
      const pos = this.toWorld(p.x, p.z);
      const target = new PracticeTarget(this.scene, new Vector3(pos.x, 0, pos.z), p.id, p.kind);
      this.practiceTargets.push(target);
      this.disposables.push(target);
    }

    // Выходные ворота на конце секции (развилки — два барьера рядом).
    for (const g of this.spec.gates) {
      if (gameState.isGateOpen(g.id)) continue;
      const pos = this.toWorld(g.x, this.spec.length - 0.3);
      const gate = new EnergyGate(this.scene, {
        id: g.id,
        requiredSpells: g.requiredSpells,
        schoolId: g.schoolId,
        x: pos.x,
        z: pos.z,
        yaw: this.spec.yaw,
        width: g.width,
        fork: g.fork,
      });
      this.gates.push(gate);
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
    this.gates = [];
    this.built = false;
  }

  /** Локальные координаты секции → мировые. */
  private toWorld(localX: number, localZ: number): { x: number; z: number } {
    return localToWorld({ start: this.spec.start, yaw: this.spec.yaw }, localX, localZ);
  }

  private buildFloor(): void {
    const center = this.toWorld(0, this.spec.length / 2);
    const floor = MeshBuilder.CreateGround(
      `floor_${this.spec.index}`,
      { width: this.spec.width, height: this.spec.length },
      this.scene
    );
    const mat = new StandardMaterial(`floorMat_${this.spec.index}`, this.scene);
    mat.diffuseColor = Color3.FromHexString(this.spec.color);
    mat.specularColor = Color3.Black();
    floor.material = mat;
    floor.rotation.y = this.spec.yaw;
    floor.position.set(center.x, 0, center.z);
    floor.checkCollisions = true;
    this.disposables.push(floor, mat);
  }

  private buildWalls(): void {
    const wallMat = new StandardMaterial(`wallMat_${this.spec.index}`, this.scene);
    wallMat.diffuseColor = Color3.FromHexString("#4a4d52");
    wallMat.specularColor = Color3.Black();
    const leftCenter = this.toWorld(-this.spec.width / 2, this.spec.length / 2);
    const rightCenter = this.toWorld(this.spec.width / 2, this.spec.length / 2);

    const left = MeshBuilder.CreateBox(
      `wallL_${this.spec.index}`,
      { width: 0.3, height: 2.5, depth: this.spec.length },
      this.scene
    );
    left.rotation.y = this.spec.yaw;
    left.position.set(leftCenter.x, 1.25, leftCenter.z);
    left.material = wallMat;
    left.checkCollisions = true;

    const right = left.clone(`wallR_${this.spec.index}`);
    right.position.set(rightCenter.x, 1.25, rightCenter.z);
    right.checkCollisions = true;

    this.disposables.push(left, right, wallMat);
  }

  /**
   * Стена-разделитель развилки: делит начало секции на два рукава (левый и
   * правый), продолжая плоскость между двумя барьерами выходных ворот. После
   * partitionDepth метров стена кончается, и секция снова открывается целиком.
   */
  private buildPartition(): void {
    if (this.spec.partitionDepth <= 0) return;
    const wallMat = new StandardMaterial(`partitionMat_${this.spec.index}`, this.scene);
    wallMat.diffuseColor = Color3.FromHexString("#4a4d52");
    wallMat.specularColor = Color3.Black();
    const center = this.toWorld(0, this.spec.partitionDepth / 2);

    const wall = MeshBuilder.CreateBox(
      `partition_${this.spec.index}`,
      { width: 0.3, height: 2.5, depth: this.spec.partitionDepth },
      this.scene
    );
    wall.rotation.y = this.spec.yaw;
    wall.position.set(center.x, 1.25, center.z);
    wall.material = wallMat;
    wall.checkCollisions = true;
    this.disposables.push(wall, wallMat);
  }

  /**
   * Ремонт стыка с предыдущей секцией — три вещи (закрывает все известные
   * дыры и провалы):
   *
   * 1) Пол-заплатка клина при изгибе: два прямоугольных пола встречаются
   *    под углом, и на ВНЕШНЕЙ стороне стыка остаётся клиновидный зазор —
   *    туда игрок проваливался сквозь старый диск (тот был без коллизий и
   *    темнее пола). Заплатка — бокс по габаритам клина, цвет = цвет
   *    ПРЕДЫДУЩЕЙ секции (неотличим от пола), с коллизией.
   * 2) Забор-заглушка на внешней стороне изгиба: между концом стены
   *    предыдущей и началом стены текущей секции зияет щель — закрываем
   *    стеной-боксом (это и есть «забор вокруг заплатки»).
   * 3) Бордюры-«уши» при смене ширины коридора (расширение 8→24 и сужение
   *    на вилках): у входа в более широкую/узкую секцию кромка пола
   *    обрывается в пустоту — низкие серые бордюры с коллизией не дают
   *    сойти с пола.
   */
  private buildJointPatch(): void {
    const spec = this.spec;
    if (spec.index === 0 || spec.prevWidth <= 0) return;

    const curHalf = spec.width / 2;
    const prevHalf = spec.prevWidth / 2;
    const maxHalf = Math.max(curHalf, prevHalf);
    const dYaw = this.normAngle(spec.yaw - spec.prevYaw);

    // --- 1) пол-заплатка клина внешнего угла при изгибе ---
    if (spec.jointRadius > 0 && Math.abs(dYaw) > 0.02) {
      const depth = maxHalf * Math.tan(Math.abs(dYaw)) + 0.8;
      const yawBis = (spec.yaw + spec.prevYaw) / 2;
      const dirBisX = Math.sin(yawBis);
      const dirBisZ = Math.cos(yawBis);

      const mat = new StandardMaterial(`jointMat_${spec.index}`, this.scene);
      mat.diffuseColor = Color3.FromHexString(spec.prevColor);
      mat.specularColor = Color3.Black();
      const patch = MeshBuilder.CreateBox(
        `joint_${spec.index}`,
        { width: maxHalf * 2 * 1.12, height: 0.08, depth },
        this.scene
      );
      patch.material = mat;
      patch.rotation.y = yawBis;
      patch.position.set(spec.start.x - dirBisX * (depth / 2), 0, spec.start.z - dirBisZ * (depth / 2));
      patch.checkCollisions = true;
      this.disposables.push(patch, mat);

      // --- 2) забор-заглушка между краями стен на внешней стороне изгиба ---
      const side = dYaw > 0 ? 1 : -1;
      const perpPX = Math.cos(spec.prevYaw);
      const perpPZ = -Math.sin(spec.prevYaw);
      const perpCX = Math.cos(spec.yaw);
      const perpCZ = -Math.sin(spec.yaw);
      const kp = { x: spec.prevEnd.x + perpPX * (side * prevHalf), z: spec.prevEnd.z + perpPZ * (side * prevHalf) };
      const kc = { x: spec.start.x + perpCX * (side * curHalf), z: spec.start.z + perpCZ * (side * curHalf) };
      const fx = kc.x - kp.x;
      const fz = kc.z - kp.z;
      const fLen = Math.hypot(fx, fz);
      if (fLen > 0.35) {
        const fMat = new StandardMaterial(`jointFenceMat_${spec.index}`, this.scene);
        fMat.diffuseColor = Color3.FromHexString("#4a4d52");
        fMat.specularColor = Color3.Black();
        const fence = MeshBuilder.CreateBox(
          `jointFence_${spec.index}`,
          { width: fLen, height: 2.5, depth: 0.3 },
          this.scene
        );
        fence.material = fMat;
        fence.rotation.y = Math.atan2(fx, fz);
        fence.position.set((kp.x + kc.x) / 2, 1.25, (kp.z + kc.z) / 2);
        fence.checkCollisions = true;
        this.disposables.push(fence, fMat);
      }
    }

    // --- 3) бордюры-«уши» по кромке входа при разной ширине секций ---
    const diffHalf = Math.abs(curHalf - prevHalf);
    if (diffHalf > 0.35) {
      const midHalf = Math.min(curHalf, prevHalf) + diffHalf / 2;
      const halfLen = diffHalf * 0.55;
      const perpCX = Math.cos(spec.yaw);
      const perpCZ = -Math.sin(spec.yaw);
      const eMat = new StandardMaterial(`edgeMat_${spec.index}`, this.scene);
      eMat.diffuseColor = Color3.FromHexString("#8a8f98");
      eMat.specularColor = Color3.Black();
      for (const s of [1, -1]) {
        const edge = MeshBuilder.CreateBox(
          `edge_${spec.index}_${s > 0 ? "r" : "l"}`,
          { width: halfLen * 2, height: 0.6, depth: 0.3 },
          this.scene
        );
        edge.material = eMat;
        edge.rotation.y = spec.yaw;
        edge.position.set(spec.start.x + perpCX * (s * midHalf), 0.3, spec.start.z + perpCZ * (s * midHalf));
        edge.checkCollisions = true;
        this.disposables.push(edge);
      }
      this.disposables.push(eMat);
    }
  }

  /** Нормализация угла в [-π, π]. */
  private normAngle(a: number): number {
    let r = a % (Math.PI * 2);
    if (r > Math.PI) r -= Math.PI * 2;
    if (r < -Math.PI) r += Math.PI * 2;
    return r;
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
   *
   * Позиции сидов переведены в МИРОВЫЕ координаты секции (поворот yaw учтён
   * в матрице инстанса вместе с собственным вращением сида).
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
      const world = this.toWorld(s.x, s.z);
      const matrix = Matrix.Compose(
        new Vector3(s.scale, s.scale, s.scale),
        Quaternion.RotationAxis(Vector3.Up(), this.spec.yaw + s.rot),
        new Vector3(world.x, baseY, world.z)
      );
      base.thinInstanceAdd(matrix, false);
    }
    base.thinInstanceRefreshBoundingInfo(true);
  }
}