import { getSpellsBySchool } from "../../data/spells";
import type { GameState } from "../../core/GameState";
import type { SectionSpec, SeamSpec, SeamPatchSpec } from "../spec/SectionSpec";
import type { TrackSnapshot } from "../spec/WorldSpec";
import type { Vec2 } from "../geometry/SectionGeometry";
import { clamp, localToWorld } from "../geometry/SectionGeometry";
import { randRange, type RandomFn, type Rng } from "../math/Rng";
import { SectionContentBuilder } from "../SectionContent";
import type { GatePlanner } from "./GatePlanner";
import type { SectionFactory } from "./SectionFactory";
import { IdFactory, SectionAssembler } from "./SectionAssembler";
import {
  APPROACH_COLOR,
  APPROACH_RULE,
  DEADEND_LENGTH,
  DEADEND_PROBABILITY,
  FIRST_SECTION_LENGTH,
  FIRST_SECTION_WIDTH,
  FORK_BRANCH_LENGTH,
  FORK_DIVERGENCE_ANGLE,
  FORK_PROBABILITY,
  MAX_BEND,
  MAX_YAW,
  SECTION_LENGTH,
  SECTION_WIDTH,
} from "./WorldGenConfig";

/** Зависимости трекбилдера — общий rng-поток, состояние игры и подсистемы. */
export interface TrackDeps {
  rng: Rng;
  gameState: GameState;
  ids: IdFactory;
  factory: SectionFactory;
  gatePlanner: GatePlanner;
  assembler: SectionAssembler;
  contentBuilder: SectionContentBuilder;
}

/** Начальное состояние трассы: свежее (generateWorld) или из снапшота (extendWorld). */
export interface TrackInit {
  seed: number;
  mainSectionCount: number;
  cursor: Vec2;
  yaw: number;
  specIndex: number;
  worldCount: number;
  prevSpec: SectionSpec | null;
}

/**
 * Построитель трассы — ПОШАГОВЫЙ и ВОЗОБНОВЛЯЕМЫЙ аппендер секций.
 *
 * Ключ архитектуры «бесконечного продления мира»: генерация одной стволовой
 * позиции (обычная секция ИЛИ развилка: parent + ветки A/B + схождение J)
 * вынесена в appendSection(), а подход к башне — в отдельный buildApproach().
 * generateWorld() делает N шагов + подход; extendWorld() восстанавливает
 * трекбилдер из снапшота (курсор/курс/индексы/счётчики/PRNG) и добавляет ещё
 * секций ПЕРЕД подходом — так мир растёт, пока игрок не готов к финальной битве.
 *
 * ВАЖНО: порядок rng-вызовов внутри appendSection/buildApproach повторяет
 * исходный монолитный генератор БИТ-В-БИТ — иначе ломается детерминизм мира по
 * seed (тесты сравнивают сериализованные secs).
 */
export class TrackBuilder {
  private readonly rng: Rng;
  private readonly rand: RandomFn;
  private readonly gameState: GameState;
  private readonly ids: IdFactory;
  private readonly factory: SectionFactory;
  private readonly gatePlanner: GatePlanner;
  private readonly assembler: SectionAssembler;
  private readonly contentBuilder: SectionContentBuilder;

  private readonly seed: number;
  private readonly mainSectionCount: number;
  private cursor: Vec2;
  private currentYaw: number;
  private currentSpecIndex: number;
  private worldCount: number;
  private prevSpec: SectionSpec | null;

  constructor(deps: TrackDeps, init: TrackInit) {
    this.rng = deps.rng;
    this.rand = deps.rng.fn;
    this.gameState = deps.gameState;
    this.ids = deps.ids;
    this.factory = deps.factory;
    this.gatePlanner = deps.gatePlanner;
    this.assembler = deps.assembler;
    this.contentBuilder = deps.contentBuilder;

    this.seed = init.seed;
    this.mainSectionCount = init.mainSectionCount;
    this.cursor = { x: init.cursor.x, z: init.cursor.z };
    this.currentYaw = init.yaw;
    this.currentSpecIndex = init.specIndex;
    this.worldCount = init.worldCount;
    this.prevSpec = init.prevSpec;
  }

  /** Применить конвейер расширений к секции. */
  private assemble(spec: SectionSpec, isFirst: boolean): void {
    this.assembler.assemble(spec, { rng: this.rand, gameState: this.gameState, ids: this.ids, isFirst });
  }

  /**
   * Есть ли ещё стволовая позиция до подхода (зеркало исходного
   * `while (worldCount < mainSectionCount)` — развилка продвигает worldCount
   * на 2, поэтому число итераций НЕ равно mainSectionCount).
   */
  public hasMoreTrunks(): boolean {
    return this.worldCount < this.mainSectionCount;
  }

  /**
   * Добавить одну стволовую позицию трассы. Возвращает добавленные секции:
   * [parent] для обычной секции ИЛИ [parent, branchA, branchB, join] для
   * развилки/тупика. Последняя позиция (worldCount === mainSectionCount - 1)
   * не получает выходных ворот — их роль играет барьер подхода.
   */
  public appendSection(): SectionSpec[] {
    const rand = this.rand;
    const isFirst = this.worldCount === 0;
    const isLast = this.worldCount === this.mainSectionCount - 1;
    const width = isFirst ? FIRST_SECTION_WIDTH : SECTION_WIDTH;
    const length = isFirst
      ? randRange(rand, FIRST_SECTION_LENGTH.min, FIRST_SECTION_LENGTH.max)
      : randRange(rand, SECTION_LENGTH.min, SECTION_LENGTH.max);
    const tier = Math.min(3, Math.floor((this.worldCount / this.mainSectionCount) * 3) + 1);

    // Курс, с которым секция НАЧИНАЕТСЯ, — курс, на котором закончилась
    // предыдущая (см. обновление currentYaw в конце итерации): стык без излома.
    const startYaw = this.currentYaw;
    let curvature = 0;
    if (!isFirst) {
      // Тот же случайный изгиб, что и раньше, но размазанный ПОСТОЯННОЙ кривизной
      // по всей длине секции — секция становится дугой, а не прямым отрезком.
      const targetEndYaw = clamp(startYaw + randRange(rand, -MAX_BEND, MAX_BEND), -MAX_YAW, MAX_YAW);
      curvature = (targetEndYaw - startYaw) / length;
    }

    const end = localToWorld({ start: this.cursor, yaw: startYaw, curvature }, 0, length);
    const parent = this.factory.create(
      this.currentSpecIndex,
      tier,
      width,
      length,
      { x: this.cursor.x, z: this.cursor.z },
      end,
      startYaw,
      curvature,
      this.prevSpec
    );
    this.currentYaw = startYaw + curvature * length; // курс в конце = курс начала следующей
    this.assemble(parent, isFirst);

    const forkAllowed =
      !isFirst &&
      !isLast &&
      this.gameState.getUnlockedSchools().filter((s) => getSpellsBySchool(s.id).length > 0).length >= 2;
    // Один бросок на оба варианта: сперва зона настоящей развилки, затем зона
    // тупика — суммарный шанс «что-то за двойными воротами» = FORK + DEADEND.
    const roll = forkAllowed ? rand() : 1;
    const fork = roll < FORK_PROBABILITY;
    const deadEnd = !fork && roll < FORK_PROBABILITY + DEADEND_PROBABILITY;

    if (fork || deadEnd) {
      return this.appendFork(parent, end, tier, deadEnd);
    }

    if (!isLast) this.gatePlanner.assignExitGates(parent, false);
    this.prevSpec = parent;
    this.cursor = end;
    this.currentSpecIndex += 1;
    this.worldCount += 1;
    return [parent];
  }

  /**
   * Развилка/тупик: родитель уже имеет двойные ворота. Две САМОСТОЯТЕЛЬНЫЕ ветки
   * (A/B) за ними; у настоящей развилки обе сходятся в J, у тупика — только одна
   * (случайно a или b), вторая короткий рукав без выхода.
   */
  private appendFork(parent: SectionSpec, end: Vec2, tier: number, deadEnd: boolean): SectionSpec[] {
    const rand = this.rand;
    this.gatePlanner.assignExitGates(parent, true, !deadEnd);

    const branchLen = randRange(rand, FORK_BRANCH_LENGTH.min, FORK_BRANCH_LENGTH.max);
    const dirX = Math.sin(this.currentYaw);
    const dirZ = Math.cos(this.currentYaw);
    const perpX = Math.cos(this.currentYaw);
    const perpZ = -Math.sin(this.currentYaw);
    const off = SECTION_WIDTH / 4;
    const branchTier = Math.min(3, tier + 1);
    // Какая из двух дверей — тупик (если это вообще тупик).
    const deadSlot: "a" | "b" | null = deadEnd ? (rand() < 0.5 ? "a" : "b") : null;

    // Ветки расходятся в РАЗНЫЕ стороны — ЗЕРКАЛЬНАЯ случайная дуга (величина
    // общая, знак противоположный): при curvature_B = -curvature_A конец ветки B
    // — точное зеркало конца A относительно оси родителя, чем и обусловлена
    // стыковка обеих веток с плоской кромкой J.
    const divergeAngle = randRange(rand, FORK_DIVERGENCE_ANGLE.min, FORK_DIVERGENCE_ANGLE.max);
    const divergeSign = rand() < 0.5 ? 1 : -1;
    const curvatureA = (-divergeSign * divergeAngle) / branchLen;
    const curvatureB = (divergeSign * divergeAngle) / branchLen;

    // ВАЖНО: ветки и J начинаются у КОНЦА родителя (где стоят её ворота), а не
    // у this.cursor: на этом шаге cursor всё ещё указывает на НАЧАЛО parent.
    const mkBranch = (branch: "a" | "b", sign: number, gateId: string): SectionSpec => {
      const isDead = branch === deadSlot;
      const branchLength = isDead ? randRange(rand, DEADEND_LENGTH.min, DEADEND_LENGTH.max) : branchLen;
      const thisTier = isDead ? tier : branchTier;
      const curvature = branch === "a" ? curvatureA : curvatureB;
      const start = { x: end.x - perpX * off * sign, z: end.z - perpZ * off * sign };
      const branchEnd = localToWorld({ start, yaw: this.currentYaw, curvature }, 0, branchLength);
      const spec = this.factory.create(
        this.currentSpecIndex + 1,
        thisTier,
        SECTION_WIDTH / 2,
        branchLength,
        start,
        branchEnd,
        this.currentYaw,
        curvature,
        parent
      );
      spec.forkBranch = branch;
      spec.forkGateId = gateId;
      spec.forkParentIndex = parent.index;
      spec.isDeadEnd = isDead;
      this.assemble(spec, false);
      return spec;
    };
    const branchA = mkBranch("a", 1, parent.gates[0].id);
    const branchB = mkBranch("b", -1, parent.gates[1].id);

    // J стыкуется с ПРОДОЛЖАЮЩЕЙ веткой (при тупике — обязательно НЕ тупиковой).
    const continuingBranch = deadSlot === "a" ? branchB : branchA;
    const otherBranch = continuingBranch === branchA ? branchB : branchA;

    // Общая секция-схождение: вход J — на исходной оси parent'а, на «глубине»
    // branchLen — там встречаются обе разошедшиеся ветки.
    const jStart = { x: end.x + dirX * branchLen, z: end.z + dirZ * branchLen };
    const jLength = randRange(rand, SECTION_LENGTH.min, SECTION_LENGTH.max);
    const jEnd = localToWorld({ start: jStart, yaw: this.currentYaw, curvature: 0 }, 0, jLength);
    const join = this.factory.create(
      this.currentSpecIndex + 2,
      tier,
      SECTION_WIDTH,
      jLength,
      jStart,
      jEnd,
      this.currentYaw,
      0,
      continuingBranch,
      deadEnd ? null : otherBranch
    );
    join.seam = this.computeSeam(jStart, [branchA, branchB], deadSlot);
    this.assemble(join, false);

    this.prevSpec = join;
    this.cursor = jEnd;
    this.currentSpecIndex += 3;
    this.worldCount += 2; // parent + J — две стволовые позиции
    return [parent, branchA, branchB, join];
  }

  /**
   * Шов «ветки → схождение J»: чистая геометрия БЕЗ rng (порядок rng-вызовов
   * appendFork не меняется — детерминизм мира сохраняется).
   *
   * Координаты шва — ЛОКАЛЬНЫЕ координаты J (x поперёк, z вдоль, вход J —
   * линия z=0 через jStart). Ветка — расходящаяся дуга: её торцевая кромка
   * наклонена к входу J, внешний угол висит перед линией входа (z<0 — дыра),
   * внутренний — заходит внутрь J (там перекрывается полом J). Заплата —
   * четырёхугольник между кромкой (обрезанной по ширине J) и линией входа,
   * с нахлёстом 0.5 м на пол J.
   */
  private computeSeam(jStart: Vec2, branches: SectionSpec[], deadSlot: "a" | "b" | null): SeamSpec {
    const patches: SeamPatchSpec[] = [];
    const backWalls: { from: Vec2; to: Vec2 }[] = [];
    // Направление входа в J = курс веток на входе (= yaw родителя на стыке).
    const yawJ = branches[0].yaw;
    const cosY = Math.cos(yawJ);
    const sinY = Math.sin(yawJ);
    // В J-локальные: dx,dz от jStart.
    const toLocal = (p: Vec2): Vec2 => {
      const dx = p.x - jStart.x;
      const dz = p.z - jStart.z;
      return { x: dx * cosY - dz * sinY, z: dx * sinY + dz * cosY };
    };

    // Проёмы веток в линии входа J (для задней стены между ними).
    const openings: { from: number; to: number }[] = [];

    for (const spec of branches) {
      // Тупиковая ветка к J не примыкает (её торец в стороне, перед ним —
      // пол родительского коридора развилки... нет: пустота) — заплаты нет;
      // её торец закрывается торцевой стеной в её собственном чанке
      // (SectionChunk.buildEnvironment, spec.isDeadEnd).
      const isDead = deadSlot !== null && spec.forkBranch === deadSlot;
      if (isDead) continue;
      // Торец ветки — spec.end + кромка ±half перпендикулярно конечному курсу.
      const endYaw = spec.yaw + spec.curvature * spec.length;
      const perpX = Math.cos(endYaw);
      const perpZ = -Math.sin(endYaw);
      const half = spec.width / 2;
      const edge = [
        toLocal({ x: spec.end.x - perpX * half, z: spec.end.z - perpZ * half }),
        toLocal({ x: spec.end.x + perpX * half, z: spec.end.z + perpZ * half }),
      ];

      // Параметризация кромки p(t) = edge0 + t*(edge1-edge0), t∈[0,1].
      // Пересечение с линией входа z=0 → t0; с шириной J |x|=J_HALF → t1,t2.
      const edgeX = edge[1].x - edge[0].x;
      const edgeZ = edge[1].z - edge[0].z;
      const J_HALF = SECTION_WIDTH / 2;
      const crossZ0 = edge[0].z;
      const crossZ1 = edge[1].z;
      if (Math.abs(crossZ0 - crossZ1) < 1e-9 && Math.abs(crossZ0) < 1e-9) {
        continue; // кромка ровно на входе J — шов не нужен
      }
      // t пересечения с |x|=J_HALF.
      const tAt = (xLevel: number) => (xLevel - edge[0].x) / edgeX;
      const tLeft = tAt(-J_HALF);
      const tRight = tAt(J_HALF);

      const at = (t: number) => ({ x: edge[0].x + edgeX * t, z: edge[0].z + edgeZ * t });
      // Клампим кромку по ДВУМ условиям: ширина J (|x|≤J_HALF) и линия входа
      // (z≤0 — часть кромки внутри J уже перекрыта её полом). Строим запла-
      // ту только под сегментом, который реально висит перед входом (z<0);
      // сегмент с z>0 перекрыт полом J — убираем из заплатки и из проёма.
      const CROSS = -1e-6; // z-уровень сегмента, который считается «висящим»
      const tZeros: number[] = [0, 1];
      if (edgeZ !== 0) {
        const tZero = -edge[0].z / edgeZ;
        if (tZero > 0 && tZero < 1) tZeros.push(tZero);
      }
      // Разбиваем кромку на сегменты [t_i, t_{i+1}], оставляем висящие (z<0).
      const tSorted = tZeros.slice().sort((p, q) => p - q);
      const hanging: { from: number; to: number }[] = [];
      for (let i = 0; i < tSorted.length - 1; i++) {
        const tm = (tSorted[i] + tSorted[i + 1]) / 2;
        if (edge[0].z + edgeZ * tm < CROSS) hanging.push({ from: tSorted[i], to: tSorted[i + 1] });
      }
      // loT/hiT — пересечение висящего диапазона с [loWidthT, hiWidthT].
      const loWidthT = Math.max(0, Math.min(tLeft, tRight));
      const hiWidthT = Math.min(1, Math.max(tLeft, tRight));
      if (hiWidthT <= loWidthT + 1e-9) continue; // кромка полностью за шириной J
      let segLo = Infinity;
      let segHi = -Infinity;
      for (const seg of hanging) {
        segLo = Math.min(segLo, seg.from);
        segHi = Math.max(segHi, seg.to);
      }
      if (segHi === -Infinity || segHi <= segLo + 1e-9) continue; // вся кромка внутри J — шов не нужен
      const loT = Math.max(segLo, loWidthT);
      const hiT = Math.min(segHi, hiWidthT);
      if (hiT <= loT + 1e-9) continue; // висящее — вне ширины J: только ограждение
      const a = at(loT);
      const b = at(hiT);
      // Нахлёст на пол J: 0.5 м вглубь. Линия входа под каждым краем — та же x.
      const OVERLAP = 0.5;
      const lineA = { x: a.x, z: OVERLAP };
      const lineB = { x: b.x, z: OVERLAP };

      // Внешний угол кромки за шириной J — для ограждений (перила+стена J назад).
      const outerCandidate = loT > 0 ? edge[0] : hiT < 1 ? edge[1] : null;
      const outerCorner = outerCandidate && Math.abs(outerCandidate.x) > J_HALF + 1e-6 ? outerCandidate : null;

      patches.push({
        color: spec.color,
        edgeA: a,
        edgeB: b,
        lineA,
        lineB,
        outerCorner,
      });

      // Проём ветки в линии входа J — проекция обрезанной кромки на z=0.
      openings.push({ from: Math.min(a.x, b.x), to: Math.max(a.x, b.x) });
    }

    // Задняя стена J: линия входа минус проёмы веток. Сортируем проёмы и
    // строим стены в зазорах — они закрывают бездну между ветками (там, где
    // кромки обеих веток висят перед входом J).
    openings.sort((p, q) => p.from - q.from);
    const J_HALF2 = SECTION_WIDTH / 2;
    let cursorX = -J_HALF2;
    for (const op of openings) {
      if (op.from - cursorX > 0.05) {
        backWalls.push({ from: { x: cursorX, z: 0 }, to: { x: op.from, z: 0 } });
      }
      cursorX = Math.max(cursorX, op.to);
    }
    if (J_HALF2 - cursorX > 0.05) {
      backWalls.push({ from: { x: cursorX, z: 0 }, to: { x: J_HALF2, z: 0 } });
    }

    return { patches, backWalls };
  }

  /**
   * Финальная секция — спокойный подход к башне (tier 0, без врагов и выхода).
   * Её вход гейтится одиночным барьером от последней боевой секции (prevSpec).
   */
  public buildApproach(): SectionSpec {
    const rand = this.rand;
    const approachStartYaw = this.currentYaw;
    const approachTargetEndYaw = clamp(approachStartYaw + randRange(rand, -MAX_BEND, MAX_BEND), -MAX_YAW, MAX_YAW);
    const approachLength = randRange(rand, SECTION_LENGTH.min, SECTION_LENGTH.max);
    const approachCurvature = (approachTargetEndYaw - approachStartYaw) / approachLength;
    const approachStart = { x: this.cursor.x, z: this.cursor.z };
    const approachEnd = localToWorld(
      { start: approachStart, yaw: approachStartYaw, curvature: approachCurvature },
      0,
      approachLength
    );

    if (this.prevSpec) this.gatePlanner.assignApproachGate(this.prevSpec);

    const approach = this.factory.create(
      this.currentSpecIndex,
      0,
      SECTION_WIDTH,
      approachLength,
      approachStart,
      approachEnd,
      approachStartYaw,
      approachCurvature,
      this.prevSpec
    );
    approach.color = APPROACH_COLOR;
    // Подход — спокойная зона: без сущностей и сундуков, только трава и бордюры.
    this.contentBuilder.apply(approach, APPROACH_RULE);
    return approach;
  }

  /** Сериализуемое продолжение трассы (для extendWorld). */
  public snapshot(): TrackSnapshot {
    return {
      seed: this.seed,
      rngState: this.rng.state,
      cursor: { x: this.cursor.x, z: this.cursor.z },
      yaw: this.currentYaw,
      specIndex: this.currentSpecIndex,
      worldCount: this.worldCount,
      mainSectionCount: this.mainSectionCount,
      ids: this.ids.snapshot(),
      gateSchoolUsage: this.gatePlanner.snapshot(),
    };
  }
}
