import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3, Matrix, Quaternion } from "@babylonjs/core";
import { SectionSpec, ScatterSeed, BorderStyle, localToWorld, yawAt } from "./WorldGenerator";
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
 * (ribbon), повторяющая изгиб (см. curvePath) — соседние секции всегда
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

  constructor(private scene: Scene, public readonly spec: SectionSpec) {}

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

    this.buildFloor();
    this.buildWalls(wallMat);
    this.buildPartition(wallMat);
    this.buildJointPatch();
    this.buildScatter(this.spec.grass, "grass");
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

  /** Длина одного шага дискретизации дуги (м) — компромисс гладкости/полигонажа. */
  private static readonly CURVE_SEGMENT_LENGTH = 2.5;
  private static readonly WALL_HEIGHT = 2.5;
  private static readonly WALL_COLOR = "#4a4d52";

  private curveSteps(): number {
    return Math.max(1, Math.round(this.spec.length / SectionChunk.CURVE_SEGMENT_LENGTH));
  }

  /**
   * Путь вдоль оси секции на фиксированном поперечном смещении localX и
   * высоте y — уже в МИРОВЫХ координатах (учитывает кривизну через toWorld).
   * Общий строительный блок для пола и стен: они больше не единый плоский
   * прямоугольник/бокс, а лента (ribbon), повторяющая изгиб секции.
   */
  private curvePath(localX: number, y: number): Vector3[] {
    const steps = this.curveSteps();
    const points: Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      const z = (this.spec.length * i) / steps;
      const p = this.toWorld(localX, z);
      points.push(new Vector3(p.x, y, p.z));
    }
    return points;
  }

  private buildFloor(): void {
    const half = this.spec.width / 2;
    const floor = MeshBuilder.CreateRibbon(
      `floor_${this.spec.index}`,
      { pathArray: [this.curvePath(-half, 0), this.curvePath(half, 0)], sideOrientation: Mesh.DOUBLESIDE },
      this.scene
    );
    const mat = this.makeMaterial(`floorMat_${this.spec.index}`, this.spec.color);
    floor.material = mat;
    floor.checkCollisions = true;
    this.disposables.push(floor, mat);
  }

  private buildWalls(wallMat: StandardMaterial): void {
    const half = this.spec.width / 2;
    const h = SectionChunk.WALL_HEIGHT;

    // Раньше правая стена была клоном левой (простой сдвиг — секция прямая,
    // обе стены одной формы). На дуге левая и правая стена — РАЗНЫЕ кривые
    // (внутренняя/внешняя сторона поворота, разный эффективный радиус),
    // клонировать нечего — строим ленту для каждой отдельно.
    const left = MeshBuilder.CreateRibbon(
      `wallL_${this.spec.index}`,
      { pathArray: [this.curvePath(-half, 0), this.curvePath(-half, h)], sideOrientation: Mesh.DOUBLESIDE },
      this.scene
    );
    left.material = wallMat;
    left.checkCollisions = true;

    const right = MeshBuilder.CreateRibbon(
      `wallR_${this.spec.index}`,
      { pathArray: [this.curvePath(half, 0), this.curvePath(half, h)], sideOrientation: Mesh.DOUBLESIDE },
      this.scene
    );
    right.material = wallMat;
    right.checkCollisions = true;

    this.disposables.push(left, right);
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
   * Ремонт стыка с предыдущей секцией: бордюры-«уши» при смене ширины
   * коридора (расширение 8→24 на входе, сужение на вилках развилки) — у
   * входа в более широкую/узкую секцию кромка пола обрывается в пустоту,
   * низкие серые бордюры с коллизией не дают сойти с пола.
   *
   * Раньше здесь ещё чинился клиновидный зазор пола и щель в заборе на
   * ВНЕШНЕЙ стороне изгиба (диск-заплатка по jointRadius) — секции были
   * прямыми, и мгновенный поворот yaw на стыке буквально раздвигал два
   * плоских прямоугольника под углом. Теперь секции — дуги ПОСТОЯННОЙ
   * кривизны (см. SectionSpec.curvature), и соседние секции по построению
   * ВСЕГДА встречаются с равным курсом (конец предыдущей = начало текущей) —
   * ни клина, ни щели в заборе больше не возникает, чинить нечего.
   */
  private buildJointPatch(): void {
    const spec = this.spec;
    if (spec.index === 0 || spec.prevWidth <= 0) return;

    const curHalf = spec.width / 2;
    const prevHalf = spec.prevWidth / 2;

    // --- бордюры-«уши» по кромке входа при разной ширине секций ---
    // ВАЖНО: раньше формула клала «уши» СИММЕТРИЧНО вокруг spec.start
    // (±midHalf), что верно только если предыдущая и текущая секции
    // делят одну осевую линию. У веток развилки и схождения J это не
    // так — они смещены вбок на ±SECTION_WIDTH/4, — и старая формула
    // сажала бордюры мимо: либо в пустоту за пределами всего коридора,
    // либо горбом высотой 0.6 прямо посреди пола соседней ветки (видно
    // как «стены не стыкуются, разной высоты»). Считаем реальную
    // проекцию prevEnd на ось ТЕКУЩЕЙ секции — без предположения об
    // общем центре — и «ухо» ставим только там, где предыдущая секция
    // ДЕЙСТВИТЕЛЬНО торчит за пределы текущей.
    //
    // Ветки развилки в «ушах» не нуждаются вовсе: их единственная
    // «оголённая» кромка обращена к территории соседней ветки, которая
    // либо построена и сама даёт пол, либо недостижима (за барьером
    // развилки) — а с внешней стороны у ветки с самого стыка уже стоит
    // её собственная полновысотная стена (buildWalls), см. WorldGenerator:
    // ветка размером SECTION_WIDTH/2 занимает ровно половину ширины
    // родителя, без зазора.
    if (!spec.forkBranch) {
      const perpCX = Math.cos(spec.yaw);
      const perpCZ = -Math.sin(spec.yaw);
      const prevCenterU = (spec.prevEnd.x - spec.start.x) * perpCX + (spec.prevEnd.z - spec.start.z) * perpCZ;
      const prevMin = prevCenterU - prevHalf;
      const prevMax = prevCenterU + prevHalf;
      const curMin = -curHalf;
      const curMax = curHalf;

      const gaps: { center: number; halfLen: number }[] = [];
      const leftGap = curMin - prevMin; // предыдущая секция торчит левее текущей
      if (leftGap > 0.35) gaps.push({ center: (prevMin + curMin) / 2, halfLen: leftGap / 2 });
      const rightGap = prevMax - curMax; // предыдущая секция торчит правее текущей
      if (rightGap > 0.35) gaps.push({ center: (curMax + prevMax) / 2, halfLen: rightGap / 2 });

      if (gaps.length > 0) {
        const eMat = this.makeMaterial(`edgeMat_${spec.index}`, "#8a8f98");
        for (const gap of gaps) {
          const edge = MeshBuilder.CreateBox(
            `edge_${spec.index}_${gap.center >= 0 ? "r" : "l"}`,
            { width: gap.halfLen * 2, height: 0.6, depth: 0.3 },
            this.scene
          );
          edge.material = eMat;
          edge.rotation.y = spec.yaw;
          edge.position.set(spec.start.x + perpCX * gap.center, 0.3, spec.start.z + perpCZ * gap.center);
          edge.checkCollisions = true;
          this.disposables.push(edge);
        }
        this.disposables.push(eMat);
      }
    }
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

    const mat = this.makeMaterial(`${kind}Mat_${this.spec.index}`, "#5fae4a");

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
    const style: BorderStyle = this.spec.borderStyle;

    let base;
    let baseY: number;
    let color: string;
    if (style === "bushes") {
      color = "#2f5b34";
      base = MeshBuilder.CreateSphere(`border${side}_${this.spec.index}`, { diameter: 1.1, segments: 6 }, this.scene);
      baseY = 0.45;
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