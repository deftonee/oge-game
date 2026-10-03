import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3, Matrix, Quaternion } from "@babylonjs/core";
import type { SectionSpec, ScatterSeed, BorderStyle } from "./spec/SectionSpec";
import { localToWorld, yawAt } from "./geometry/SectionGeometry";
import { FootprintIndex, type FootprintPiece, type WallSeg } from "./geometry/Footprint";
import { Witch } from "../entities/Witch";
import { Bonfire } from "../entities/Bonfire";
import { PracticeTarget } from "../entities/PracticeTarget";
import { Chest } from "../entities/Chest";
import { EnergyGate } from "../entities/EnergyGate";
import { getSpellById } from "../data/spells";
import { GameState } from "../core/GameState";

/**
 * Один "чанк" мира — пол, стены, трава, кусты, ведьмы, костры и сундуки одной
 * секции. build()/dispose() полностью создают и полностью разбирают всю
 * геометрию — это и есть потоковая загрузка "только текущая секция в памяти"
 * (см. ТЗ). Побеждённые ведьмы (gameState.isWitchDefeated) и открытые сундуки
 * (gameState.isChestOpen) при пересборке восстанавливаются из состояния, а не
 * создаются заново с нуля.
 *
 * Класс отвечает только за ГЕОМЕТРИЮ и материализацию данных spec:
 *   - buildEnvironment() — статическая геометрия секции (пол/стены/бордюры/декор);
 *   - buildEntities()    — интерактивные сущности (ведьмы/костры/цели/сундуки/ворота).
 * Наполнение spec сущностями — не его забота (см. SectionContentBuilder).
 *
 * Секция лежит в собственной локальной системе координат (x — поперёк,
 * z — вдоль дуги коридора постоянной кривизны spec.curvature): все сущности
 * и декор из spec заданы в локальных координатах и переводятся в мировые
 * здесь же (toWorld). Пол и стены — не плоский прямоугольник/бокс, а лента
 * (ribbon), повторяющая изгиб (см. buildFloors) — соседние секции всегда
 * встречаются с равным курсом, без излома и без диска-заплатки на стыке.
 * Выходные ворота (spec.gates) стоят на КОНЦЕ секции.
 */
export class SectionChunk {
  public witches: Witch[] = [];
  public bonfires: Bonfire[] = [];
  public practiceTargets: PracticeTarget[] = [];
  public chests: Chest[] = [];
  /** Выходные ворота секции (0..2 — при развилке оба барьера активны). */
  public gates: EnergyGate[] = [];
  private built = false;
  private disposables: { dispose(): void }[] = [];

  /**
   * footprints — пол ВСЕГО мира (см. geometry/Footprint): стены чанка выводятся
   * из границы пола с учётом соседей, независимо от того, какие из них сейчас
   * построены. Без него чанк знает только о себе (для тестов/ручных секций).
   */
  private readonly footprints: FootprintIndex;

  constructor(private scene: Scene, public readonly spec: SectionSpec, footprints?: FootprintIndex) {
    this.footprints = footprints ?? new FootprintIndex([spec]);
  }

  public get isBuilt(): boolean {
    return this.built;
  }

  public build(gameState: GameState): void {
    if (this.built) return;
    this.built = true;

    this.buildEnvironment();
    this.buildEntities(gameState);

    // eslint-disable-next-line no-console
    console.log(
      `[stream] #${this.spec.index} BUILD tier=${this.spec.tier} "${this.spec.color}" yaw=${this.spec.yaw.toFixed(3)} start=(${this.spec.start.x.toFixed(2)},${this.spec.start.z.toFixed(2)}) end=(${this.spec.end.x.toFixed(2)},${this.spec.end.z.toFixed(2)}) width=${this.spec.width} length=${this.spec.length.toFixed(2)} gates=${this.spec.gates.length}`
    );
  }

  public dispose(): void {
    if (!this.built) return;
    // Логируем ДО разборки: после dispose сцена уже пуста и непонятно, что было.
    const gateIds = this.gates.map((g) => g.id).join(",");
    // eslint-disable-next-line no-console
    console.log(
      `[stream] #${this.spec.index} DISPOSE tier=${this.spec.tier} gates=[${gateIds || "-"}]`
    );
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.witches = [];
    this.bonfires = [];
    this.practiceTargets = [];
    this.chests = [];
    this.gates = [];
    this.built = false;
  }

  // -------------------------------------------------------------------------
  // Статическая геометрия секции
  // -------------------------------------------------------------------------

  private buildEnvironment(): void {
    const wallMat = this.makeMaterial(`wallMat_${this.spec.index}`, SectionChunk.WALL_COLOR);
    this.disposables.push(wallMat);

    // Пол и стены выводятся из ОДНОГО набора полигонов (geometry/Footprint):
    // пол — меши по этим полигонам, стены — границы объединения полов, не
    // закрытые соседним полом. Стыки секций, схождение веток, ниши, тупики,
    // спавн и площадка у башни — всё это частные случаи одного правила, а не
    // отдельные заплатки.
    this.buildFloors();
    this.buildBoundaryWalls(wallMat);
    this.buildPartition(wallMat);
    this.buildScatter(this.spec.grass, "grass");
    this.buildScatter(this.spec.bushes, "bush");
    this.buildBorder(this.spec.borderLeft);
    this.buildBorder(this.spec.borderRight);
  }

  /** Единый хелпер материала: диффузный цвет + без блика (все декорации матовые). */
  private makeMaterial(name: string, colorHex: string): StandardMaterial {
    const mat = new StandardMaterial(name, this.scene);
    mat.diffuseColor = Color3.FromHexString(colorHex);
    mat.specularColor = Color3.Black();
    return mat;
  }

  /** Локальные координаты секции → мировые. */
  private toWorld(localX: number, localZ: number): { x: number; z: number } {
    return localToWorld(this.spec, localX, localZ);
  }

  private static readonly WALL_HEIGHT = 2.5;
  private static readonly WALL_COLOR = "#4a4d52";

  /**
   * Пол: по мешу-ленте на каждый полигон секции (полоса-дуга, заплатки шва
   * веток, ниши, площадка у башни). Меш строится из тех же точек, что и
   * полигон, из которого выводятся стены, — «пол ≠ коллизия» невозможно.
   */
  private buildFloors(): void {
    const materials = new Map<string, StandardMaterial>();
    for (const piece of this.footprints.piecesOf(this.spec)) {
      let mat = materials.get(piece.color);
      if (!mat) {
        mat = this.makeMaterial(`floorMat_${piece.id}`, piece.color);
        materials.set(piece.color, mat);
        this.disposables.push(mat);
      }
      const floor = MeshBuilder.CreateRibbon(
        `floor_${piece.id}`,
        { pathArray: this.railPaths(piece), sideOrientation: Mesh.DOUBLESIDE },
        this.scene
      );
      floor.material = mat;
      floor.checkCollisions = true;
      this.disposables.push(floor);
    }
  }

  private railPaths(piece: FootprintPiece): Vector3[][] {
    return piece.rails.map((rail) => rail.map((p) => new Vector3(p.x, piece.y, p.z)));
  }

  /**
   * Стены: ровно по границе пола, не закрытой соседним полом (см.
   * FootprintIndex.wallsOf). Каждый кусок — тонкий бокс, внутренняя грань
   * которого лежит на кромке пола, а тело растёт НАРУЖУ — в бездну, поэтому
   * не заходит в проходимую зону. Все боксы чанка сливаются в один меш:
   * один draw call и один коллайдер на секцию.
   */
  private buildBoundaryWalls(wallMat: StandardMaterial): void {
    const walls: readonly WallSeg[] = this.footprints.wallsOf(this.spec);
    if (walls.length === 0) return;
    const h = SectionChunk.WALL_HEIGHT;
    const boxes: Mesh[] = walls.map((w, i) => {
      const dx = w.b.x - w.a.x;
      const dz = w.b.z - w.a.z;
      const box = MeshBuilder.CreateBox(
        `wallBox_${this.spec.index}_${i}`,
        { width: Math.hypot(dx, dz), height: h, depth: w.t },
        this.scene
      );
      // Поворот на φ переводит локальную +x в (cosφ, -sinφ) — нужное нам (dx,dz)/len.
      box.rotation.y = Math.atan2(-dz, dx);
      box.position.set((w.a.x + w.b.x) / 2 + (w.n.x * w.t) / 2, h / 2, (w.a.z + w.b.z) / 2 + (w.n.z * w.t) / 2);
      return box;
    });

    const merged = boxes.length > 1 ? Mesh.MergeMeshes(boxes, true, true) : boxes[0];
    if (merged) {
      merged.name = `walls_${this.spec.index}${this.spec.forkBranch ?? ""}`;
      merged.material = wallMat;
      merged.checkCollisions = true;
      this.disposables.push(merged);
    } else {
      // Слияние не удалось — остаются отдельные боксы (работает, просто дороже).
      for (const box of boxes) {
        box.material = wallMat;
        box.checkCollisions = true;
        this.disposables.push(box);
      }
    }
  }

  /**
   * Стена-разделитель развилки: делит начало секции на два рукава (левый и
   * правый), продолжая плоскость между двумя барьерами выходных ворот. После
   * partitionDepth метров стена кончается, и секция снова открывается целиком.
   */
  private buildPartition(wallMat: StandardMaterial): void {
    if (this.spec.partitionDepth <= 0) return;
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
    this.disposables.push(wall);
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
  private buildScatter(seeds: ScatterSeed[], kind: "grass" | "bush"): void {
    if (seeds.length === 0) return;

    const mat = this.makeMaterial(`${kind}Mat_${this.spec.index}`, kind === "bush" ? "#1f3d22" : "#5fae4a");
    // Делаем куст чуть матовым — глянец травы не должен "забивать" их на фоне.
    if (kind === "bush") {
      mat.specularColor = new Color3(0.05, 0.05, 0.05);
      mat.specularPower = 32;
    }

    // Кусты — крупные укрытия ≈1.5× игрока (игрок 1.8 м, куст 2.04–3.6 м при
    // scale 0.85–1.5). baseY = радиус для среднего scale — стыковка с землёй
    // доведена в scatterInstances через worldY = baseY * s.scale (см. ниже).
    const base =
      kind === "bush"
        ? MeshBuilder.CreateSphere(`${kind}_${this.spec.index}`, { diameter: 2.4, segments: 6 }, this.scene)
        : MeshBuilder.CreateCylinder(
            `${kind}_${this.spec.index}`,
            { diameterTop: 0, diameterBottom: 0.18, height: 0.4 },
            this.scene
          );
    base.material = mat;
    this.scatterInstances(base, seeds, kind === "bush" ? 1.2 : 0.2);
    this.disposables.push(base, mat);
  }

  /**
   * Граница коридора вместо плоской чёрной стены (по фидбэку) — случайный
   * стиль на секцию: густые кусты, металлический забор или скальная гряда.
   * Реальный коллайдер — тонкая невидимая-под-декором стена из buildBoundaryWalls();
   * эти меши чисто декоративные, коллизий не имеют.
   */
  private buildBorder(seeds: ScatterSeed[]): void {
    if (seeds.length === 0) return;

    const side = seeds === this.spec.borderLeft ? "L" : "R";
    const style: BorderStyle = this.spec.borderStyle;

    let base;
    let baseY: number;
    let color: string;
    if (style === "bushes") {
      color = "#2f5b34";
      base = MeshBuilder.CreateSphere(`border${side}_${this.spec.index}`, { diameter: 2.4, segments: 6 }, this.scene);
      baseY = 1.2;
    } else if (style === "fence") {
      color = "#8a8f98";
      base = MeshBuilder.CreateBox(`border${side}_${this.spec.index}`, { width: 0.12, height: 1.3, depth: 0.12 }, this.scene);
      baseY = 0.65;
    } else {
      color = "#5c5347";
      base = MeshBuilder.CreateSphere(`border${side}_${this.spec.index}`, { diameter: 1.3, segments: 4 }, this.scene);
      baseY = 0.55;
    }
    const mat = this.makeMaterial(`border${side}Mat_${this.spec.index}`, color);
    base.material = mat;

    this.scatterInstances(base, seeds, baseY);
    this.disposables.push(base, mat);
  }

  /**
   * Общий хелпер: раскладывает сиды как тонкие инстансы заданного базового меша.
   *
   * ВАЖНО: y центра = baseY * s.scale — масштабируется вместе с инстансом,
   * иначе при scale > 1 куст/столб «всплывают» над землёй, а при scale < 1
   * зарываются в пол (раньше трава качалась на ±6 см, бордюрные кусты были
   * наполовину в полу — отсюда жалоба «кустов не видно»). Базовые меши
   * сконструированы так, что низ лежит на y=0 при canonical-масштабе.
   */
  private scatterInstances(base: Mesh, seeds: ScatterSeed[], baseY: number): void {
    // Кусты и бордюрный декор — ПОЛНЫЕ instances (createInstance), не thin:
    // их единицы на секцию, thin-инстансинг в рантайме не отрисовывал их
    // (баг не локализован, а полные instance копируют проверенный путь ведьм).
    // Трава остаётся на thin (сотни окты на секцию, один draw call).
    if (base.name.startsWith("bush") || base.name.startsWith("borderb") || base.name.startsWith("borderL") || base.name.startsWith("borderR")) {
      for (const s of seeds) {
        const world = this.toWorld(s.x, s.z);
        const inst = base.createInstance(`${base.name}_i${base.instances.length}`);
        inst.position.set(world.x, baseY * s.scale, world.z);
        inst.scaling.setAll(s.scale);
        inst.rotation.y = this.spec.yaw + s.rot;
        this.disposables.push(inst);
      }
      base.isVisible = false; // рендерятся только инстансы; база — источник геометрии
      return;
    }
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      const world = this.toWorld(s.x, s.z);
      const matrix = Matrix.Compose(
        new Vector3(s.scale, s.scale, s.scale),
        Quaternion.RotationAxis(Vector3.Up(), this.spec.yaw + s.rot),
        new Vector3(world.x, baseY * s.scale, world.z)
      );
      base.thinInstanceAdd(matrix, false);
    }
    base.thinInstanceRefreshBoundingInfo(true);
  }

  // -------------------------------------------------------------------------
  // Интерактивные сущности секции
  // -------------------------------------------------------------------------

  /**
   * Материализует данные spec в объекты сцены. Объекты — только там, где это
   * согласовано с состоянием игры: побеждённые ведьмы возвращаются дружелюбными
   * (Witch сам читает isWitchDefeated), открытые сундуки — уже открытыми
   * (Chest читает isChestOpen), открытые ворота не создаются вовсе.
   */
  private buildEntities(gameState: GameState): void {
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

    for (const c of this.spec.chests) {
      const pos = this.toWorld(c.x, c.z);
      const chest = new Chest(
        this.scene,
        new Vector3(pos.x, 0, pos.z),
        { id: c.id, bookIds: c.bookIds, pageIds: c.pageIds },
        gameState
      );
      this.chests.push(chest);
      this.disposables.push(chest);
    }

    for (const g of this.spec.gates) this.buildGate(g, gameState);

    this.buildSideSpurEntities(gameState);
  }

  /**
   * Ведьма+сундук ниши — координаты в её СОБСТВЕННОЙ локальной системе
   * (см. buildSideSpurGeometry), а не в системе родителя. Результат кладём
   * в те же this.witches/this.chests — стример и HUD не различают, откуда
   * взялась сущность (см. ProximityDetector/WorldStreamer.getActive*).
   */
  private buildSideSpurEntities(gameState: GameState): void {
    for (const spur of this.spec.sideSpurs) {
      const frame = { start: spur.start, yaw: spur.yaw, curvature: 0 };

      const wPos = localToWorld(frame, spur.witch.x, spur.witch.z);
      const witch = new Witch(
        this.scene,
        new Vector3(wPos.x, 0, wPos.z),
        getSpellById(spur.witch.spellId),
        spur.witch.id,
        gameState.isWitchDefeated(spur.witch.id)
      );
      this.witches.push(witch);
      this.disposables.push(witch);

      const cPos = localToWorld(frame, spur.chest.x, spur.chest.z);
      const chest = new Chest(
        this.scene,
        new Vector3(cPos.x, 0, cPos.z),
        { id: spur.chest.id, bookIds: spur.chest.bookIds, pageIds: spur.chest.pageIds },
        gameState
      );
      this.chests.push(chest);
      this.disposables.push(chest);
    }
  }

  /** Выходные ворота на конце секции (развилки — два барьера рядом). */
  private buildGate(g: SectionSpec["gates"][number], gameState: GameState): void {
    if (gameState.isGateOpen(g.id)) {
      // eslint-disable-next-line no-console
      console.log(`[stream] #${this.spec.index} build SKIP gate=${g.id} (already open)`);
      return;
    }
    const gateZ = this.spec.length - 0.3;
    const pos = this.toWorld(g.x, gateZ);
    const gate = new EnergyGate(this.scene, {
      id: g.id,
      requiredSpells: g.requiredSpells,
      schoolId: g.schoolId,
      x: pos.x,
      z: pos.z,
      // Барьер сам по себе плоский и прямой независимо от кривизны
      // коридора — но его ориентация обязана следовать КАСАТЕЛЬНОЙ в точке,
      // где он стоит (конец секции), а не постоянному курсу её начала —
      // иначе на изогнутой секции барьер встанет под углом к полу.
      yaw: yawAt(this.spec, gateZ),
      width: g.width,
      fork: g.fork,
    });
    this.gates.push(gate);
    this.disposables.push(gate);
    // eslint-disable-next-line no-console
    console.log(
      `[stream] #${this.spec.index} build +gate id=${g.id} school=${g.schoolId ?? "-"} req=${g.requiredSpells} fork=${!!g.fork} pos=(${pos.x.toFixed(2)},${pos.z.toFixed(2)}) width=${g.width.toFixed(2)}`
    );
  }
}