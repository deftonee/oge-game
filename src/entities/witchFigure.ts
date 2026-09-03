/**
 * witchFigure.ts — процедурная фигурка валяной ведьмы для Babylon.js.
 * Порт witch_figure.js (Downloads) на ES-модули/TypeScript:
 *  - именованные импорты из @babylonjs/core вместо глобального BABYLON;
 *  - префикс имён нод/материалов (несколько ведьм в одной сцене);
 *  - цвет платья переопределяется (цвет заклинания);
 *  - шляпа сгруппирована в TransformNode — скрыть = «снять шляпу»;
 *  - масштаб фигурки через root.scaling.
 *
 * v2 — «менее геометрично, более валяно»:
 *  - тело и шляпа — не прямые примитивы, а CreateLathe/CreateTube по
 *    Catmull-Rom сплайну через контрольные точки (Curve3), поэтому силуэт
 *    волнистый, а не идеально прямая линия;
 *  - materials — PBRMaterial + sheen вместо StandardMaterial: физически
 *    осмысленный "тканевый" блик по краям. Нужна environment-текстура в
 *    сцене, см. комментарий у makeFabricMaterial;
 *  - addSurfaceNoise() — плавное (не случайное по вершинам) смещение
 *    поверхности вдоль нормали, поверх сплайнового силуэта.
 *
 * Оригинальная фигурка ~4.25 единицы в высоту (кончик шляпы), лицо смотрит в +Z.
 */
import {
  Animation,
  Color3,
  Curve3,
  EasingFunction,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  QuadraticEase,
  Scalar,
  Scene,
  SineEase,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
  type IAnimationKey,
} from "@babylonjs/core";

export const WITCH_EXPRESSIONS = ["grumpy", "neutral", "angry", "surprised", "sad", "happy"] as const;
export type WitchExpression = (typeof WITCH_EXPRESSIONS)[number];

export interface WitchFigureOptions {
  /** Уникальный префикс имён нод/материалов (для нескольких ведьм в сцене). */
  namePrefix?: string;
  /** Цвет платья (тело ведьмы). По умолчанию — тёмный войлок. */
  robeColor?: Color3;
  /** Масштаб фигурки. Оригинал ~4.25 в модельных единицах. */
  scale?: number;
}

export interface WitchFigure {
  readonly root: TransformNode;
  /** Группа шляпы: hide = «сняла шляпу» (дружелюбный режим). */
  readonly hat: TransformNode;
  /** Группа бороды: hide = «сбрила бороду» / молодая версия персонажа. */
  readonly beard: TransformNode;
  /** Материал платья — для перекраски/осветления. */
  readonly robeMat: PBRMaterial;
  playIdle(): void;
  stopIdle(): void;
  swingStaff(onComplete?: () => void): void;
  setExpression(name: WitchExpression, frames?: number): void;
  getExpression(): WitchExpression;
  readonly expressionNames: readonly WitchExpression[];
  dispose(): void;
}

interface Expression {
  // brow  — наклон брови (рад), зеркалится для правой стороны
  // browY — смещение брови по Y относительно базовой высоты
  // mouth — кривизна рта: минус = грусть/хмурость, плюс = улыбка
  brow: number;
  browY: number;
  mouth: number;
}

const EXPRESSIONS: Record<WitchExpression, Expression> = {
  grumpy: { brow: 0.35, browY: -0.015, mouth: -0.055 }, // по умолчанию, как на фото-игрушке
  neutral: { brow: 0.12, browY: 0, mouth: -0.015 },
  angry: { brow: 0.55, browY: -0.03, mouth: -0.075 },
  surprised: { brow: -0.28, browY: 0.05, mouth: 0.02 },
  sad: { brow: 0.22, browY: -0.04, mouth: -0.08 },
  happy: { brow: -0.08, browY: 0.02, mouth: 0.07 },
};

const BROW_BASE_Y = 2.42;

// ================= Органичная поверхность =================
// Идеально гладкие примитивы (сфера/конус/цилиндр) читаются как точёное
// дерево или пластик. Небольшое, но НЕ случайное по каждой вершине
// (иначе будет "шум", а не "лепка"), а плавное смещение вдоль нормали —
// самый дешёвый способ придать форме рукотворную неровность.
function smoothNoise3(x: number, y: number, z: number, freq: number, seed: number): number {
  return (
    Math.sin(x * freq + seed) +
    Math.sin(y * freq * 1.7 + seed * 1.3) +
    Math.sin(z * freq * 2.3 + seed * 0.6)
  ) / 3; // примерно в диапазоне [-1, 1]
}

function addSurfaceNoise(mesh: Mesh, amplitude: number, frequency: number, seed: number): void {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
  const indices = mesh.getIndices();
  if (!positions || !normals || !indices) return;

  for (let i = 0; i < positions.length; i += 3) {
    const n = smoothNoise3(positions[i], positions[i + 1], positions[i + 2], frequency, seed) * amplitude;
    positions[i] += normals[i] * n;
    positions[i + 1] += normals[i + 1] * n;
    positions[i + 2] += normals[i + 2] * n;
  }

  mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
  VertexData.ComputeNormals(positions, indices, normals);
  mesh.updateVerticesData(VertexBuffer.NormalKind, normals);
}

// Направленная (не случайная) лепка головы: сужение нижней половины
// к подбородку + выступ подбородка вперёд-вниз только в нижне-передней
// области. В отличие от addSurfaceNoise, здесь смещение предсказуемо
// зависит от позиции вершины, а не от шума — так получается форма,
// а не рябь.
function sculptHead(mesh: Mesh, jawTaper: number, chinPush: number): void {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
  const indices = mesh.getIndices();
  if (!positions || !normals || !indices) return;

  for (let i = 0; i < positions.length; i += 3) {
    let x = positions[i];
    let y = positions[i + 1];
    let z = positions[i + 2];

    // сужение нижней половины (скулы -> подбородок), спереди и сзади одинаково
    if (y < 0) {
      const taper = 1 - Math.min(1, -y / 0.42) * jawTaper;
      x *= taper;
      z *= taper;
    }

    // выступ подбородка — только нижне-передняя четверть
    if (y < -0.08 && z > 0.05) {
      const vertical = Math.min(1, (-y - 0.08) / 0.3);
      const forward = Math.min(1, (z - 0.05) / 0.3);
      const t = vertical * forward;
      z += t * chinPush;
      y -= t * chinPush * 0.25;
    }

    positions[i] = x;
    positions[i + 1] = y;
    positions[i + 2] = z;
  }

  mesh.updateVerticesData(VertexBuffer.PositionKind, positions);
  VertexData.ComputeNormals(positions, indices, normals);
  mesh.updateVerticesData(VertexBuffer.NormalKind, normals);
}

// Радиус профиля тела (см. CreateLathe ниже) на заданной высоте —
// линейная интерполяция между соседними точками профиля. Нужно, чтобы
// привязать плечи РУК к фактической поверхности тела, а не к угаданным
// координатам, которые рассинхронизируются при правке bodyControlPoints.
function radiusAtHeight(profile: Vector3[], targetY: number): number {
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1];
    const b = profile[i];
    if (targetY >= a.y && targetY <= b.y) {
      const t = (targetY - a.y) / Math.max(1e-6, b.y - a.y);
      return Scalar.Lerp(a.x, b.x, t);
    }
  }
  return targetY < profile[0].y ? profile[0].x : profile[profile.length - 1].x;
}

export function createWitchFigure(scene: Scene, options: WitchFigureOptions = {}): WitchFigure {
  const prefix = options.namePrefix ? `${options.namePrefix}_` : "";
  const root = new TransformNode(`${prefix}witchRoot`, scene);
  if (options.scale !== undefined) root.scaling.setAll(options.scale);

  // ================= Материалы =================
  // PBRMaterial + sheen — физически осмысленный "ткане/войлочный" блик:
  // мягкое усиление яркости на касательных углах (по краям формы), а не
  // одна резкая точка блика, как у пластика/лака в StandardMaterial.
  // Для полной отдачи sheen'а сцене нужна environment-текстура — добавьте
  // ОДИН РАЗ в код инициализации сцены (не здесь, в фабрике персонажа,
  // чтобы не плодить второй skybox/ground при нескольких персонажах):
  //   scene.createDefaultEnvironment({ createSkybox: false, createGround: false });
  const makeFabricMaterial = (name: string, albedo: Color3): PBRMaterial => {
    const mat = new PBRMaterial(name, scene);
    mat.albedoColor = albedo;
    mat.metallic = 0;
    mat.roughness = 0.85; // высокая шероховатость = матовая, не глянцевая
    mat.sheen.isEnabled = true;
    mat.sheen.intensity = 0.55;
    return mat;
  };

  const makeSolidMaterial = (name: string, albedo: Color3, roughness: number): PBRMaterial => {
    const mat = new PBRMaterial(name, scene);
    mat.albedoColor = albedo;
    mat.metallic = 0;
    mat.roughness = roughness;
    return mat;
  };

  const feltDark = makeFabricMaterial(`${prefix}feltDark`, new Color3(0.16, 0.16, 0.18));
  const robeMat = makeFabricMaterial(`${prefix}robe`, (options.robeColor ?? new Color3(0.16, 0.16, 0.18)).clone());
  // Мягкая светло-серая шерсть — борода
  const beardMat = makeFabricMaterial(`${prefix}beard`, new Color3(0.72, 0.7, 0.66));
  // Приглушённо-серый, темнее бороды — брови-пучки. Должны читаться на
  // фоне кожи (мимика), поэтому не такие светлые, как beardMat.
  const browMat = makeFabricMaterial(`${prefix}browMat`, new Color3(0.32, 0.29, 0.27));

  const skinMat = makeSolidMaterial(`${prefix}skin`, new Color3(0.9, 0.75, 0.55), 0.6);
  const noseMat = makeSolidMaterial(`${prefix}nose`, new Color3(0.85, 0.55, 0.25), 0.55);
  const woodMat = makeSolidMaterial(`${prefix}wood`, new Color3(0.35, 0.22, 0.12), 0.45);
  // Глаза-бусины на фото блестящие, почти стеклянные — низкая шероховатость,
  // выделяются на фоне матовой шерсти остального персонажа.
  const darkMat = makeSolidMaterial(`${prefix}dark`, new Color3(0.02, 0.02, 0.02), 0.2);

  // ================= Тело =================
  // Раньше — прямой конус (CreateCylinder), силуэт которого идеально
  // прямая линия от пола до плеч, отсюда и "геометричность". Теперь —
  // профиль из контрольных точек (низ / "юбка" у пола / талия / плечи),
  // сглаженный Catmull-Rom сплайном, revolve через CreateLathe. Силуэт
  // получается волнистым, а не прямым — именно это читается как "слеплено
  // руками", а не "выточено на станке".
  const bodyControlPoints = [
    new Vector3(0, 0, 0),
    new Vector3(0.72, 0.03, 0),
    new Vector3(0.78, 0.2, 0), // "юбка" — шерсть слегка оседает вширь у пола
    new Vector3(0.73, 0.45, 0),
    new Vector3(0.6, 0.78, 0),
    new Vector3(0.48, 1.08, 0),
    new Vector3(0.37, 1.38, 0),
    new Vector3(0.27, 1.63, 0),
    new Vector3(0.16, 1.85, 0),
    new Vector3(0.06, 1.97, 0),
    new Vector3(0, 2.0, 0),
  ];
  const bodyProfile = Curve3.CreateCatmullRomSpline(bodyControlPoints, 5, false).getPoints();

  const body = MeshBuilder.CreateLathe(`${prefix}body`, {
    shape: bodyProfile,
    radius: 1, // shape уже содержит абсолютный радиус, доп. масштаб не нужен
    tessellation: 24,
    updatable: true,
  }, scene);
  body.material = robeMat;
  body.parent = root;
  addSurfaceNoise(body, 0.025, 2.2, 11);

  // ================= Голова и лицо =================
  // Раньше — почти шар (scaling.y всего 1.05), отсюда "круглое лицо".
  // Теперь заметно вытянута по Y + sculptHead сужает нижнюю половину
  // к подбородку и толкает нижне-переднюю область вперёд — получается
  // выраженный, выступающий подбородок, а не ровный овал.
  const head = MeshBuilder.CreateSphere(`${prefix}head`, { diameter: 0.9, segments: 20, updatable: true }, scene);
  head.position.y = 2.22;
  head.scaling.y = 1.3;
  head.material = skinMat;
  head.parent = root;
  sculptHead(head, 0.55, 0.16);
  addSurfaceNoise(head, 0.01, 3.5, 27);

  // Раньше — прямой конус (CreateCylinder), отсюда "нос-морковка".
  // Теперь — кривая труба по сплайну с НЕ монотонным радиусом: узко у
  // переносицы, шире на "бульбочке" ближе к концу, чуть уже на самом
  // кончике. Плюс сама труба загибается вниз — характерный крючок.
  const noseControlPoints = [
    new Vector3(0, 0, 0),
    new Vector3(0, -0.03, 0.13),
    new Vector3(0, -0.09, 0.24),
    new Vector3(0, -0.17, 0.32),
    new Vector3(0, -0.23, 0.35),
  ];
  const nosePath = Curve3.CreateCatmullRomSpline(noseControlPoints, 5, false).getPoints();

  const nose = MeshBuilder.CreateTube(`${prefix}nose`, {
    path: nosePath,
    radiusFunction: (i: number) => {
      const t = i / (nosePath.length - 1);
      return t < 0.55
        ? Scalar.Lerp(0.05, 0.095, t / 0.55) // переносица -> бульбочка
        : Scalar.Lerp(0.095, 0.05, (t - 0.55) / 0.45); // бульбочка -> кончик
    },
    tessellation: 10,
    cap: Mesh.CAP_ALL,
    updatable: true,
  }, scene);
  nose.position = new Vector3(0, 2.24, 0.32); // основание внутри головы, шва не видно
  nose.material = noseMat;
  nose.parent = root;
  addSurfaceNoise(nose, 0.004, 8, 63);

  const createEye = (side: number): void => {
    const eye = MeshBuilder.CreateSphere(`${prefix}eye${side}`, { diameter: 0.09 }, scene);
    eye.position = new Vector3(0.16 * side, 2.32, 0.38);
    eye.material = darkMat;
    eye.parent = root;
  };
  createEye(-1);
  createEye(1);

  // Брови — сплюснутая сфера (а не box) с пивотом у переносицы: даёт
  // мягкий, скруглённый силуэт "пучка шерсти" вместо пластиковой
  // пластинки, но rotation.z по-прежнему читается как нахмуривание.
  const createBrow = (side: number): MeshBuilderBrow => {
    const brow = MeshBuilder.CreateSphere(`${prefix}brow${side}`, { diameter: 1, segments: 8 }, scene);
    brow.scaling = new Vector3(0.16, 0.04, 0.035);
    brow.position = new Vector3(0.17 * side, BROW_BASE_Y + EXPRESSIONS.grumpy.browY, 0.4);
    brow.rotation.z = EXPRESSIONS.grumpy.brow * side;
    brow.material = browMat; // серая шерсть, а не чёрный пластик, но с контрастом к коже
    brow.parent = root;
    brow.setPivotPoint(new Vector3(-0.5 * side, 0, 0)); // в локальных координатах сферы (радиус 0.5)
    return brow;
  };
  const browL = createBrow(-1);
  const browR = createBrow(1);

  type MeshBuilderBrow = ReturnType<typeof MeshBuilder.CreateSphere>;

  // Рот — тонкая труба по 3 точкам. Геометрию нельзя анимировать напрямую
  // через Animation, поэтому пересобираем её вручную при изменении
  // mouthState.curve (см. onBeforeRenderObservable ниже).
  const mouthState = { curve: EXPRESSIONS.grumpy.mouth };
  let lastMouthCurve = mouthState.curve;
  let mouth: ReturnType<typeof MeshBuilder.CreateTube> | null = null;

  const buildMouth = (curve: number): void => {
    if (mouth) mouth.dispose();
    const path = [
      new Vector3(-0.11, 0, 0),
      new Vector3(0, curve, 0),
      new Vector3(0.11, 0, 0),
    ];
    mouth = MeshBuilder.CreateTube(`${prefix}mouth`, { path, radius: 0.016, tessellation: 8 }, scene);
    mouth.position = new Vector3(0, 1.98, 0.43);
    mouth.material = darkMat;
    mouth.parent = root;
  };
  buildMouth(mouthState.curve);

  const mouthObserver = scene.onBeforeRenderObservable.add(() => {
    if (Math.abs(mouthState.curve - lastMouthCurve) > 0.0005) {
      buildMouth(mouthState.curve);
      lastMouthCurve = mouthState.curve;
    }
  });

  // ================= Борода (группа) =================
  // Раньше — 9 отдельных тонких прядей одинаковой толщины: между ними
  // просвечивала кожа, особенно под подбородком — отсюда "редкая,
  // странная". Теперь — одна сплошная "масса" (один tube по U-образному
  // сплайну от уха до уха, толще под подбородком, тоньше у ушей), плюс
  // всего несколько прядей поверх для лёгкой лохматости на кончике —
  // не единственный источник формы, а акцент.
  const beard = new TransformNode(`${prefix}beard`, scene);
  beard.parent = root;

  const beardMainPoints = [
    new Vector3(-0.34, 1.98, 0.2),
    new Vector3(-0.22, 1.75, 0.32),
    new Vector3(-0.1, 1.5, 0.4),
    new Vector3(0, 1.28, 0.44), // самая нижняя точка — под подбородком
    new Vector3(0.1, 1.5, 0.4),
    new Vector3(0.22, 1.75, 0.32),
    new Vector3(0.34, 1.98, 0.2),
  ];
  const beardMainPath = Curve3.CreateCatmullRomSpline(beardMainPoints, 8, false).getPoints();

  const beardMain = MeshBuilder.CreateTube(`${prefix}beardMain`, {
    path: beardMainPath,
    radiusFunction: (i: number) => {
      const t = i / (beardMainPath.length - 1);
      const centerBias = Math.max(0, 1 - Math.abs(t - 0.5) * 2); // 0 у ушей, 1 под подбородком
      return Scalar.Lerp(0.05, 0.2, Math.pow(centerBias, 0.75));
    },
    tessellation: 10,
    cap: Mesh.CAP_ALL,
    updatable: true,
  }, scene);
  beardMain.material = beardMat;
  beardMain.parent = beard;
  addSurfaceNoise(beardMain, 0.02, 3, 91); // лёгкая "свалянность" поверхности

  const wisps = 4;
  for (let i = 0; i < wisps; i++) {
    const t = i / (wisps - 1);
    const spreadX = Scalar.Lerp(-0.2, 0.2, t);
    const lengthY = Scalar.RandomRange(0.25, 0.45);
    const curveZ = Scalar.RandomRange(0.04, 0.12);
    const path = [
      new Vector3(spreadX, 1.32, 0.42),
      new Vector3(spreadX * 1.1, 1.32 - lengthY * 0.6, 0.4 + curveZ * 0.5),
      new Vector3(spreadX * 1.2, 1.32 - lengthY, 0.34 + curveZ),
    ];
    const wisp = MeshBuilder.CreateTube(`${prefix}beardWisp${i}`, {
      path,
      radiusFunction: (idx: number) => 0.025 * (1 - idx / 12),
      tessellation: 6,
    }, scene);
    wisp.material = beardMat;
    wisp.parent = beard;
  }

  // ================= Шляпа (группа) =================
  const hat = new TransformNode(`${prefix}hat`, scene);
  hat.parent = root;

  const hatBrim = MeshBuilder.CreateCylinder(`${prefix}hatBrim`, {
    diameterTop: 1.15,
    diameterBottom: 1.15,
    height: 0.06,
    tessellation: 24,
  }, scene);
  hatBrim.position = new Vector3(0, 2.62, 0.05);
  hatBrim.material = feltDark;
  hatBrim.parent = hat;

  // Раньше — прямой конус (CreateCylinder) + отдельно приклеенный
  // загнутый кончик (CreateTube). Стык между ними и сама прямая часть
  // конуса читались как две геометрических детали. Теперь — ОДИН
  // непрерывный tube по сплайну через контрольные точки: изгиб идёт
  // по всей длине шляпы, а не только в последних 20%, как на фото.
  const hatControlPoints = [
    new Vector3(0, 0, 0.02),
    new Vector3(0, 0.35, -0.02),
    new Vector3(0, 0.7, -0.04),
    new Vector3(0, 1.02, 0.0),
    new Vector3(0, 1.28, 0.14),
    new Vector3(0, 1.45, 0.32),
    new Vector3(0, 1.42, 0.5),
    new Vector3(0, 1.3, 0.6),
  ];
  const hatSpine = Curve3.CreateCatmullRomSpline(hatControlPoints, 6, false).getPoints();
  const hatBaseRadius = 0.33;

  const hatCone = MeshBuilder.CreateTube(`${prefix}hatCone`, {
    path: hatSpine,
    // степень >1 — конус сужается не линейно, а чуть вогнуто, естественнее
    radiusFunction: (i: number) => hatBaseRadius * Math.pow(1 - i / (hatSpine.length - 1), 1.35),
    tessellation: 16,
    cap: Mesh.CAP_START, // низ закрыт (у кончика радиус и так сходится к 0)
    updatable: true,
  }, scene);
  hatCone.position = new Vector3(0, 2.62, 0.03);
  hatCone.material = feltDark;
  hatCone.parent = hat;
  addSurfaceNoise(hatCone, 0.016, 2.4, 47);

  // ================= Руки =================
  interface ArmRig {
    pivot: TransformNode;
    handLocalPos: Vector3;
  }

  // Раньше x-координата плеча (0.58*side) была угадана и не совпадала с
  // реальной шириной корпуса на этой высоте — рука визуально висела в
  // воздухе, оторванная от тела. Берём фактический радиус профиля тела.
  const shoulderY = 1.55;
  const shoulderRadius = radiusAtHeight(bodyProfile, shoulderY);

  // Правая рука (держит посох) в состоянии покоя чуть отведена в
  // сторону — иначе длинная трость задевает шляпу.
  const armRestZ: Record<number, number> = { [-1]: -0.08, [1]: 0.24 };

  const createArm = (side: number): ArmRig => {
    const pivot = new TransformNode(`${prefix}armPivot${side}`, scene);
    pivot.position = new Vector3(shoulderRadius * 0.82 * side, shoulderY, shoulderRadius * 0.35);
    pivot.rotation.z = armRestZ[side];
    pivot.parent = root;

    // Небольшой "нарост" плеча в точке стыка — скрывает шов между
    // рукавом-трубой и корпусом (та же идея, что с носом на голове).
    const shoulderCap = MeshBuilder.CreateSphere(`${prefix}shoulderCap${side}`, {
      diameter: shoulderRadius * 0.85,
    }, scene);
    shoulderCap.position = pivot.position.clone();
    shoulderCap.material = robeMat;
    shoulderCap.parent = root;

    const path = [
      new Vector3(0, 0, 0),
      new Vector3(0.08 * side, -0.38, 0.05),
      new Vector3(0.12 * side, -0.74, 0.08),
    ];
    const arm = MeshBuilder.CreateTube(`${prefix}arm${side}`, { path, radius: 0.065, tessellation: 12 }, scene);
    arm.material = feltDark;
    arm.parent = pivot;

    const hand = MeshBuilder.CreateSphere(`${prefix}hand${side}`, { diameter: 0.18 }, scene);
    hand.position = path[2].clone();
    hand.material = skinMat;
    hand.parent = pivot;

    return { pivot, handLocalPos: path[2].clone() };
  };
  const leftArm = createArm(-1);
  const rightArm = createArm(1); // правая рука держит посох

  // ================= Посох =================
  // Пивот посоха закреплён в кисти правой руки — посох «держится» в руке
  // и следует за её вращением при взмахе.
  const staffPivot = new TransformNode(`${prefix}staffPivot`, scene);
  staffPivot.parent = rightArm.pivot;
  staffPivot.position = rightArm.handLocalPos.clone();

  // Раньше position.y=-0.9 при height=1.9 закапывало ~90% трости под
  // пол (видна была только короткая "культя" у кисти — отсюда "мелкая").
  // Теперь длина и положение считаются от примерной мировой высоты
  // кисти, чтобы низ доставал почти до пола, а верх — выше плеча.
  const handWorldY = shoulderY - 0.74 * Math.cos(armRestZ[1]);
  const staffBottomWorldY = 0.04; // чуть выше пола, без z-fighting
  const staffTopWorldY = shoulderY + 0.4; // заметно выше плеча
  const staffHeight = staffTopWorldY - staffBottomWorldY;

  const staff = MeshBuilder.CreateCylinder(`${prefix}staff`, {
    diameterTop: 0.05,
    diameterBottom: 0.075,
    height: staffHeight,
    tessellation: 8,
  }, scene);
  staff.position.y = (staffBottomWorldY + staffTopWorldY) / 2 - handWorldY;
  staff.material = woodMat;
  staff.parent = staffPivot;

  // ================= Вспомогательные функции анимации =================
  function getProp(target: object, property: string): number {
    let value: unknown = target;
    for (const key of property.split(".")) {
      value = (value as Record<string, unknown>)[key];
    }
    return value as number;
  }

  function animateTo(
    target: object,
    property: string,
    value: number,
    frames: number,
    fps: number,
    ease: EasingFunction,
  ): void {
    const anim = new Animation(
      `anim_${property.replace(".", "_")}_${Math.random().toString(36).slice(2, 7)}`,
      property,
      fps,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    );
    anim.setKeys([
      { frame: 0, value: getProp(target, property) },
      { frame: frames, value },
    ]);
    anim.setEasingFunction(ease);
    scene.beginDirectAnimation(target, [anim], 0, frames, false);
  }

  // ================= Idle-анимация рук =================
  let idleActive = false;

  function playIdle(): void {
    idleActive = true;
    [leftArm, rightArm].forEach((arm) => {
      const anim = new Animation(
        `idleSwing_${arm.pivot.name}`,
        "rotation.x",
        30,
        Animation.ANIMATIONTYPE_FLOAT,
        Animation.ANIMATIONLOOPMODE_CYCLE,
      );
      anim.setKeys([
        { frame: 0, value: -0.06 },
        { frame: 45, value: 0.06 },
        { frame: 90, value: -0.06 },
      ]);
      const ease = new SineEase();
      ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);
      anim.setEasingFunction(ease);
      scene.beginDirectAnimation(arm.pivot, [anim], 0, 90, true);
    });
  }

  function stopIdle(): void {
    idleActive = false;
    scene.stopAnimation(leftArm.pivot);
    scene.stopAnimation(rightArm.pivot);
  }

  // ================= Взмах посохом (рандомизирован) =================
  function swingStaff(onComplete?: () => void): void {
    const wasIdle = idleActive;
    scene.stopAnimation(rightArm.pivot); // снимаем idle, чтобы не конфликтовала

    const amplitude = Scalar.RandomRange(0.9, 1.3); // сила взмаха, рад
    const duration = Scalar.RandomRange(0.35, 0.55); // секунды
    const tiltZ = Scalar.RandomRange(-0.15, 0.15); // боковой наклон
    const fps = 30;
    const totalFrames = Math.max(1, Math.round(duration * fps));
    const peakFrame = Math.round(totalFrames * 0.35);

    const ease = new QuadraticEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    const animX = new Animation("staffSwingX", "rotation.x", fps,
      Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    animX.setKeys([
      { frame: 0, value: rightArm.pivot.rotation.x },
      { frame: peakFrame, value: -amplitude },
      { frame: totalFrames, value: 0 },
    ]);
    animX.setEasingFunction(ease);

    const animZ = new Animation("staffSwingZ", "rotation.z", fps,
      Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    animZ.setKeys([
      { frame: 0, value: rightArm.pivot.rotation.z },
      { frame: peakFrame, value: armRestZ[1] + tiltZ },
      { frame: totalFrames, value: armRestZ[1] },
    ]);
    animZ.setEasingFunction(ease);

    scene.beginDirectAnimation(rightArm.pivot, [animX, animZ], 0, totalFrames, false, 1.0, () => {
      if (wasIdle) playIdle(); // возвращаем idle после взмаха
      onComplete?.();
    });
  }

  // ================= Смена мимики =================
  let currentExpression: WitchExpression = "grumpy";

  function setExpression(name: WitchExpression, frames = 15): void {
    currentExpression = name;
    const fps = 30;
    const ease = new QuadraticEase();
    ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);

    animateTo(browL, "rotation.z", EXPRESSIONS[name].brow, frames, fps, ease);
    animateTo(browL, "position.y", BROW_BASE_Y + EXPRESSIONS[name].browY, frames, fps, ease);
    animateTo(browR, "rotation.z", -EXPRESSIONS[name].brow, frames, fps, ease);
    animateTo(browR, "position.y", BROW_BASE_Y + EXPRESSIONS[name].browY, frames, fps, ease);

    scene.stopAnimation(mouthState);
    const mouthAnim = new Animation("mouthCurveAnim", "curve", fps,
      Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    mouthAnim.setKeys([
      { frame: 0, value: mouthState.curve },
      { frame: frames, value: EXPRESSIONS[name].mouth },
    ] as IAnimationKey[]);
    mouthAnim.setEasingFunction(ease);
    scene.beginDirectAnimation(mouthState, [mouthAnim], 0, frames, false);
  }

  function dispose(): void {
    scene.onBeforeRenderObservable.remove(mouthObserver);
    root.dispose();
    [feltDark, robeMat, skinMat, noseMat, woodMat, darkMat, beardMat, browMat].forEach((m) => m.dispose());
  }

  return {
    root,
    hat,
    beard,
    robeMat,
    playIdle,
    stopIdle,
    swingStaff,
    setExpression,
    getExpression: () => currentExpression,
    expressionNames: WITCH_EXPRESSIONS,
    dispose,
  };
}