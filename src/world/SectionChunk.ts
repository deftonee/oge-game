import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3 } from "@babylonjs/core";
import type { SectionSpec, ScatterSeed, BorderStyle } from "./spec/SectionSpec";
import { localToWorld, yawAt } from "./geometry/SectionGeometry";
import { FootprintIndex, type FootprintPiece, type WallSeg } from "./geometry/Footprint";
import { Witch } from "../entities/Witch";
import { Bonfire } from "../entities/Bonfire";
import { PracticeTarget } from "../entities/PracticeTarget";
import { Chest } from "../entities/Chest";
import { EnergyGate } from "../entities/EnergyGate";
import type { BushVolume } from "../stealth/bushes";
import { eyeLevelRadius, type TreeVolume } from "../stealth/cover";
import { getSpellById } from "../data/spells";
import { GameState } from "../core/GameState";
import { getQuality } from "../core/quality";
import { DEFAULT_BIOME, getBiome, type BiomeDef } from "./biomes/biomes";
import { buildClassroom } from "./biomes/classroom/ClassroomBuilder";
import { createClassroomFloorMaterial, floorUvs } from "./biomes/classroom/textures";
import { buildSteampunk } from "./biomes/steampunk/SteampunkBuilder";
import { createSteampunkFloorMaterial, steampunkFloorUvs } from "./biomes/steampunk/textures";
import { createGrassTuft, scatterGrass } from "../render/grass";
import {
  BUSH_ENVELOPE_RADIUS,
  CANOPY_ENVELOPE_RADIUS,
  createBush,
  createCanopy,
  createThicketBase,
  variantKeyAt,
} from "../render/foliage";

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
  /** Кусты-укрытия секции (стелс: игрок внутри — невидим для ведьм). */
  public bushVolumes: BushVolume[] = [];
  /** Деревья рощ: перекрывают обзор ведьм (стелс), крона прозрачнеет между камерой и игроком. */
  public treeVolumes: TreeVolume[] = [];
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
    this.bushVolumes = [];
    this.treeVolumes = [];
    this.built = false;
  }

  // -------------------------------------------------------------------------
  // Статическая геометрия секции
  // -------------------------------------------------------------------------

  /** Окружение секции (spec.biome; у вручную собранных секций без поля — поле). */
  private get biome(): BiomeDef {
    return getBiome(this.spec.biome ?? DEFAULT_BIOME);
  }

  private buildEnvironment(): void {
    const wallMat = this.makeMaterial(`wallMat_${this.spec.index}`, this.biome.wallColor);
    this.disposables.push(wallMat);

    // Пол и стены выводятся из ОДНОГО набора полигонов (geometry/Footprint):
    // пол — меши по этим полигонам, стены — границы объединения полов, не
    // закрытые соседним полом. Стыки секций, схождение веток, ниши, тупики,
    // спавн и площадка у башни — всё это частные случаи одного правила, а не
    // отдельные заплатки.
    this.buildFloors();
    this.buildBoundaryWalls(wallMat);

    // Окружение «класс»: вместо травы, кустов, деревьев и бордюра — мебель и
    // оборудование (см. biomes/classroom). Пол и стены выше общие для всех биомов.
    if (this.spec.biome === "classroom") {
      buildClassroom({
        scene: this.scene,
        spec: this.spec,
        toWorld: (x, z) => this.toWorld(x, z),
        disposables: this.disposables,
        bushVolumes: this.bushVolumes,
        treeVolumes: this.treeVolumes,
      });
      return;
    }

    // Окружение «стимпанк» (тема термодинамики): вместо травы и кустов — паровые машины,
    // котлы и клубы пара (см. biomes/steampunk). Пол и стены выше общие для всех биомов.
    if (this.spec.biome === "steampunk") {
      buildSteampunk({
        scene: this.scene,
        spec: this.spec,
        toWorld: (x, z) => this.toWorld(x, z),
        disposables: this.disposables,
        bushVolumes: this.bushVolumes,
        treeVolumes: this.treeVolumes,
      });
      return;
    }

    this.buildGrass();
    this.buildBushes();
    this.buildTrees();
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

  /**
   * Пол: по мешу-ленте на каждый полигон секции (полоса-дуга, заплатки шва
   * веток, ниши, площадка у башни). Меш строится из тех же точек, что и
   * полигон, из которого выводятся стены, — «пол ≠ коллизия» невозможно.
   */
  private buildFloors(): void {
    const materials = new Map<string, StandardMaterial>();
    const biome = this.spec.biome;
    for (const piece of this.footprints.piecesOf(this.spec)) {
      let mat = materials.get(piece.color);
      if (!mat) {
        // Класс — плитка, стимпанк — клёпаная сталь, оба с цветом секции (если нет canvas —
        // однотонный пол, как у остальных биомов).
        const name = `floorMat_${piece.id}`;
        const textured =
          biome === "classroom"
            ? createClassroomFloorMaterial(this.scene, name, piece.color)
            : biome === "steampunk"
              ? createSteampunkFloorMaterial(this.scene, name, piece.color)
              : null;
        mat = textured ?? this.makeMaterial(name, piece.color);
        materials.set(piece.color, mat);
        this.disposables.push(mat);
      }
      const paths = this.railPaths(piece);
      const uvs = !mat.diffuseTexture ? undefined : biome === "steampunk" ? steampunkFloorUvs(paths) : floorUvs(paths);
      const floor = MeshBuilder.CreateRibbon(
        `floor_${piece.id}`,
        { pathArray: paths, sideOrientation: Mesh.DOUBLESIDE, ...(uvs ? { uvs } : {}) },
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
    const h = this.biome.wallHeight; // высота стен — свойство окружения
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
   * Трава — один меш-пучок, все точки — тонкие инстансы (один draw call на всю
   * траву секции вместо сотен мешей). Каждый сид spec разворачивается в
   * несколько пучков вокруг своей точки (сколько — решает профиль качества:
   * на слабых устройствах пучок один и из меньшего числа травинок), см. render/grass.
   *
   * ВАЖНО: матрицы тонких инстансов умножаются на собственную мировую матрицу
   * базового меша ("the original mesh is the parent of the instances" —
   * подтверждено на форуме Babylon.js). Поэтому базовый меш обязан остаться
   * в identity-трансформе (позиция 0,0,0, без поворота/масштаба) — иначе
   * все инстансы получают двойное преобразование и улетают в случайные
   * точки далеко за пределы поля. Он же обязан оставаться видимым: у тонких
   * инстансов нет отдельного объекта для рендера, рисует сам базовый меш.
   *
   * Позиции сидов переведены в МИРОВЫЕ координаты секции (поворот yaw учтён
   * в матрице инстанса вместе с собственным вращением сида).
   */
  private buildGrass(): void {
    const seeds = this.spec.grass;
    if (seeds.length === 0) return;

    const quality = getQuality();
    const base = createGrassTuft(this.scene, `grass_${this.spec.index}`, quality.grassBladesPerTuft);
    const points = seeds.map((s) => {
      const world = this.toWorld(s.x, s.z);
      return { x: world.x, z: world.z, rot: this.spec.yaw + s.rot, scale: s.scale };
    });
    scatterGrass(base, points, quality.grassTuftsPerSeed);
    this.disposables.push(base);
  }

  /**
   * Кусты-укрытия: КАЖДЫЙ куст — отдельный меш (а не инстанс общего).
   * Причина: у instanced mesh в Babylon нет собственной прозрачности
   * ("Setting visibility on an instanced mesh has no effect"), а нам нужно
   * делать полупрозрачным только тот куст, в котором стоит игрок. Кустов
   * мало (см. generateBushSeeds), а клон шаблона (render/foliage) делит
   * геометрию и материал с остальными — разные меши стоят дёшево.
   *
   * Габарит куста — сфера радиуса BUSH_ENVELOPE_RADIUS × scale (комки листвы
   * лежат внутри неё), по ней StealthManager решает, спрятан ли игрок.
   * y центра = радиус × scale, чтобы низ куста лежал на земле.
   */
  private buildBushes(): void {
    const seeds = this.spec.bushes;
    if (seeds.length === 0) return;

    const baseRadius = BUSH_ENVELOPE_RADIUS;
    seeds.forEach((s, i) => {
      const world = this.toWorld(s.x, s.z);
      const mesh = createBush(this.scene, `bush_${this.spec.index}_${i}`, variantKeyAt(world.x, world.z));
      mesh.position.set(world.x, baseRadius * s.scale, world.z);
      mesh.scaling.setAll(s.scale);
      mesh.rotation.y = this.spec.yaw + s.rot;
      this.disposables.push(mesh);
      const radius = baseRadius * s.scale;
      this.bushVolumes.push({
        kind: "bush",
        x: world.x,
        z: world.z,
        radius,
        blockRadius: eyeLevelRadius(radius, radius), // центр габарита на высоте radius
        mesh,
        alpha: 1,
        setAlpha: (a) => {
          mesh.visibility = a;
        },
      });
    });
  }

  /**
   * Рощицы: деревья стоят кучками по 3–5 (см. generateTreeGroves) и перекрывают
   * обзор ведьм — за ними можно скрыться от взгляда. Ствол — тонкий коллайдер
   * (сквозь дерево не пройти ни игроку, ни ведьме), крона — отдельный меш
   * (кучка комков листвы) на каждое дерево: её можно делать прозрачной, когда она между камерой
   * и игроком (см. StealthManager). Стволы — инстансы одной основы (1 draw call).
   */
  private static readonly TREE_TRUNK_HEIGHT = 2.0;
  private static readonly TREE_CANOPY_Y = 2.0;

  private buildTrees(): void {
    const seeds = this.spec.trees;
    if (seeds.length === 0) return;

    const idx = this.spec.index;
    const trunkMat = this.makeMaterial(`treeTrunkMat_${idx}`, "#6b4a2f");
    const trunkBase = MeshBuilder.CreateCylinder(
      `treeTrunk_${idx}`,
      { diameterTop: 0.24, diameterBottom: 0.34, height: SectionChunk.TREE_TRUNK_HEIGHT, tessellation: 8 },
      this.scene
    );
    trunkBase.material = trunkMat;
    trunkBase.isVisible = false; // рендерятся только инстансы
    this.disposables.push(trunkMat, trunkBase);

    seeds.forEach((s, i) => {
      const world = this.toWorld(s.x, s.z);

      const trunk = trunkBase.createInstance(`treeTrunk_${idx}_i${i}`);
      trunk.position.set(world.x, (SectionChunk.TREE_TRUNK_HEIGHT / 2) * s.scale, world.z);
      trunk.scaling.setAll(s.scale);
      trunk.rotation.y = this.spec.yaw + s.rot;
      this.disposables.push(trunk);

      const canopyRadius = CANOPY_ENVELOPE_RADIUS * s.scale;
      const canopyY = SectionChunk.TREE_CANOPY_Y * s.scale;
      // Крона — комки листвы внутри сферы-габарита (render/foliage); isPickable=false внутри
      // createCanopy: не мешает лучу видимости ведьм (обзор считаем по кругам, см. cover.ts).
      const canopy = createCanopy(this.scene, `treeCanopy_${idx}_${i}`, variantKeyAt(world.x, world.z));
      canopy.position.set(world.x, canopyY, world.z);
      canopy.scaling.setAll(s.scale);
      canopy.rotation.y = this.spec.yaw + s.rot;
      this.disposables.push(canopy);

      // Невидимый ствол-коллайдер: тонкий цилиндр (имя не floor_/walls_, т.е. не часть проверяемой геометрии).
      const collider = MeshBuilder.CreateCylinder(
        `treeCol_${idx}_${i}`,
        { diameter: 0.56 * s.scale, height: 2.2, tessellation: 8 },
        this.scene
      );
      collider.position.set(world.x, 1.1, world.z);
      collider.isVisible = false;
      collider.isPickable = false;
      collider.checkCollisions = true;
      this.disposables.push(collider);

      this.treeVolumes.push({
        x: world.x,
        z: world.z,
        blockRadius: eyeLevelRadius(canopyRadius, canopyY),
        canopyY,
        canopyRadius,
        canopy,
        alpha: 1,
      });
    });
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

    if (style === "bushes") {
      // Заросли — комки листвы из общего набора (render/foliage); материал общий, свой не нужен.
      const baseName = `border${side}_${this.spec.index}`;
      const base = createThicketBase(this.scene, baseName, variantKeyAt(this.spec.index, side === "L" ? 1 : 2));
      const baseY = BUSH_ENVELOPE_RADIUS;
      this.scatterInstances(base, seeds, baseY);
      this.disposables.push(base);
      this.registerThickets(base, seeds, baseY);
      return;
    }

    let base;
    let baseY: number;
    let color: string;
    if (style === "fence") {
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
   * Заросли у края коридора — такие же укрытия, как отдельные кусты: можно
   * зайти внутрь и стать невидимым. Визуал — инстансы общей основы (один draw
   * call на сторону), а у инстансов прозрачности по одному нет. Поэтому, пока
   * в зарослях стоит игрок, соответствующий инстанс выключается и вместо него
   * показывается призрачный меш-двойник (клон основы: общая геометрия и материал,
   * своя visibility); двойники создаются лениво — их одновременно единицы.
   */
  private registerThickets(base: Mesh, seeds: ScatterSeed[], baseY: number): void {
    const baseRadius = BUSH_ENVELOPE_RADIUS;
    seeds.forEach((s, i) => {
      const inst = base.instances[i];
      if (!inst) return;
      const world = this.toWorld(s.x, s.z);
      const radius = baseRadius * s.scale;
      let ghost: Mesh | null = null;

      this.bushVolumes.push({
        kind: "thicket",
        x: world.x,
        z: world.z,
        radius,
        blockRadius: eyeLevelRadius(radius, baseY * s.scale),
        mesh: inst,
        alpha: 1,
        setAlpha: (a) => {
          if (a >= 1) {
            if (ghost && ghost.isEnabled()) ghost.setEnabled(false);
            if (!inst.isEnabled()) inst.setEnabled(true);
            return;
          }
          if (!ghost) {
            ghost = base.clone(`${inst.name}_ghost`); // основа невидима — двойник включаем явно
            ghost.isVisible = true;
            ghost.setEnabled(true);
            ghost.position.copyFrom(inst.position);
            ghost.scaling.copyFrom(inst.scaling);
            ghost.rotation.copyFrom(inst.rotation);
            ghost.isPickable = false;
            this.disposables.push(ghost);
          }
          if (!ghost.isEnabled()) ghost.setEnabled(true);
          ghost.visibility = a;
          if (inst.isEnabled()) inst.setEnabled(false);
        },
      });
    });
  }

  /**
   * Раскладывает сиды бордюра как ПОЛНЫЕ instances (createInstance) базового меша.
   *
   * ВАЖНО: y центра = baseY * s.scale — масштабируется вместе с инстансом,
   * иначе при scale > 1 куст/столб «всплывают» над землёй, а при scale < 1
   * зарываются в пол (раньше бордюрные кусты были наполовину в полу — отсюда
   * жалоба «кустов не видно»). Базовые меши сконструированы так, что низ лежит
   * на y=0 при canonical-масштабе.
   *
   * Тонкие инстансы тут не годятся: база должна быть невидимой (рисуются только
   * инстансы), а у тонких инстансов рисует сама база. Кусты-укрытия сюда не
   * попадают — они отдельные меши, см. buildBushes().
   */
  private scatterInstances(base: Mesh, seeds: ScatterSeed[], baseY: number): void {
    for (const s of seeds) {
      const world = this.toWorld(s.x, s.z);
      const inst = base.createInstance(`${base.name}_i${base.instances.length}`);
      inst.position.set(world.x, baseY * s.scale, world.z);
      inst.scaling.setAll(s.scale);
      inst.rotation.y = this.spec.yaw + s.rot;
      this.disposables.push(inst);
    }
    base.isVisible = false; // рендерятся только инстансы; база — источник геометрии
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
      witch.sectionIndex = this.spec.index;
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
      // Деревца и крапива в классе неуместны: биом может подменить вид цели (логика та же).
      const target = new PracticeTarget(this.scene, new Vector3(pos.x, 0, pos.z), p.id, this.biome.practiceKind ?? p.kind);
      this.practiceTargets.push(target);
      this.disposables.push(target);
    }

    for (const c of this.spec.chests) {
      const pos = this.toWorld(c.x, c.z);
      const chest = new Chest(
        this.scene,
        new Vector3(pos.x, 0, pos.z),
        { id: c.id, bookIds: c.bookIds, pageIds: c.pageIds, dynamicSlots: c.dynamic?.slots },
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
      witch.sectionIndex = this.spec.index;
      this.witches.push(witch);
      this.disposables.push(witch);

      const cPos = localToWorld(frame, spur.chest.x, spur.chest.z);
      const chest = new Chest(
        this.scene,
        new Vector3(cPos.x, 0, cPos.z),
        { id: spur.chest.id, bookIds: spur.chest.bookIds, pageIds: spur.chest.pageIds, dynamicSlots: spur.chest.dynamic?.slots },
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