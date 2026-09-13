import { ALL_SPELLS, getSpellsBySchool } from "../data/spells";
import { GameState } from "../core/GameState";
import { SectionContentBuilder, type SectionContentRule } from "./SectionContent";


export interface WitchSpec {
  id: string;
  /** Локальная координата поперёк коридора. */
  x: number;
  /** Локальная координата вдоль коридора (0 = вход секции). */
  z: number;
  spellId: string;
}

export interface BonfireSpec {
  id: string;
  x: number;
  z: number;
}

export interface ScatterSeed {
  x: number;
  z: number;
  rot: number;
  scale: number;
}

export type PracticeTargetKind = "tree" | "dummy" | "nettle";

export interface PracticeTargetSpec {
  id: string;
  x: number;
  z: number;
  kind: PracticeTargetKind;
}

/**
 * Сундук в секции (локальные координаты). Содержимое — книги (берутся целиком)
 * и отдельные страницы; оно участвует в процедурном планировании: пока у
 * игрока есть не собранные страницы (см. SectionContentBuilder), сундуки
 * появляются в мире и содержат именно их.
 */
export interface ChestSpec {
  id: string;
  x: number;
  z: number;
  bookIds: string[];
  pageIds: string[];
}

/**
 * Перпендикулярный боковой тупик ("ниша"): короткий САМОСТОЯТЕЛЬНЫЙ рукав,
 * отходящий от основного коридора ПОД УГЛОМ 90° через проём в его стене —
 * в отличие от развилки (WorldGenerator.DEADEND_PROBABILITY), которая идёт
 * ПРЯМО и делит ширину коридора, эта ниша не склеена с телом секции: у неё
 * собственные пол/стены/торцевая стена в собственной локальной системе
 * координат (`start`/`yaw`, curvature всегда 0 — рукав короткий и прямой),
 * связанные с родителем только проёмом-вырезом в его стене (см.
 * SectionChunk.buildWalls). Всегда ровно один сундук и одна охраняющая его
 * ведьма (см. SectionContentBuilder.buildSideSpurContent) — не появляется,
 * если нечем наградить (весь лор собран) или некому напасть (школы заперты).
 */
export interface SideSpurSpec {
  id: string;
  /** К какой стене родителя пристроена ниша — нужно для выреза проёма. */
  side: "left" | "right";
  /** Мировая точка проёма (локальный (0,0) ниши). */
  start: { x: number; z: number };
  /** Курс рукава в мире — перпендикулярен родителю в точке проёма. */
  yaw: number;
  /** Ширина ниши (она же ширина проёма в стене родителя). */
  width: number;
  /** Длина рукава от проёма до тупиковой торцевой стены. */
  length: number;
  /** Локальная (вдоль оси РОДИТЕЛЯ) позиция проёма — для выреза в его стене. */
  doorZ: number;
  /** Координаты — локальные координаты НИШИ (0,0 = проём). */
  witch: WitchSpec;
  chest: ChestSpec;
}

/**
 * Выходные ворота секции (стоят на её КОНЦЕ). У секции их 0..2:
 *   0 — только у служебной секции подхода к башне (дальше туман и башня),
 *   1 — обычный проход в следующую секцию,
 *   2 — развилка: два барьера по половине коридора на разные ветки прокачки.
 */
export interface GateSpec {
  id: string;
  /** Сколько тем нужно изучить суммарно (по любой школе), чтобы пробить барьер. */
  requiredSpells: number;
  /** Ветка прокачки (школа), к которой ведут ворота — тематика барьера. */
  schoolId: string | null;
  /** Локальный x центра барьера (0 — одиночные ворота; ±width/4 — развилка). */
  x: number;
  /** Ширина барьера. */
  width: number;
  /** Ворота развилки: после открытия проход только вперёд (односторонний блок). */
  fork?: boolean;
}

export type BorderStyle = "bushes" | "fence" | "mountains";

export interface SectionSpec {
  index: number;
  tier: number; // 1-3 сложность; 0 — служебная секция подхода к башне, без врагов
  color: string;
  borderStyle: BorderStyle;
  /** Протяжённость секции вдоль её собственной оси (локальные z: 0..length). */
  length: number;
  /** Ширина коридора секции (первая секция — узкий вход; остальные 3×). */
  width: number;
  /** Мировая точка начала осевой линии секции (локальный (0, 0)). */
  start: { x: number; z: number };
  /** Мировая точка конца осевой линии секции (локальный (0, length)). */
  end: { x: number; z: number };
  /** Направление коридора в мире В НАЧАЛЕ секции, рад (0 = +Z). */
  yaw: number;
  /**
   * Кривизна оси секции, рад/метр: курс в точке пути s равен `yaw +
   * curvature*s` — секция является дугой ПОСТОЯННОЙ кривизны (0 — прямая,
   * как ветки/схождения развилки и самая первая секция). Соседняя секция
   * всегда начинается с курсом, равным курсу В КОНЦЕ предыдущей
   * (`yaw + curvature*length`), поэтому стык между секциями больше не
   * даёт видимого излома — раньше поворот случался МГНОВЕННО на границе
   * (см. историю поля jointRadius и SectionChunk.buildJointPatch в
   * истории репозитория), теперь он размазан по всей длине секции.
   */
  curvature: number;
  /** Выходные ворота на конце секции (см. GateSpec). */
  gates: GateSpec[];
  /** Длина средней стены-разделителя после развилки (0 — обычная секция). */
  partitionDepth: number;
  /**
   * Ширина и конец предыдущей секции — нужны только для бордюров-«ушей» на
   * стыке разной ширины коридора (расширение входа 8→24, сужение на вилках
   * развилки), см. SectionChunk.buildJointPatch.
   */
  prevWidth: number;
  prevEnd: { x: number; z: number };
  /** Признак ветки развилки: A/B параллельные коридоры за двойными воротами. */
  forkBranch?: "a" | "b";
  /**
   * Тупиковый рукав: эта ветка развилки никуда не сходится — за ней нет
   * выходных ворот (`gates` пуст), и барьер, ведущий в неё, НЕ односторонний
   * (см. assignExitGates(..., oneWay)) — можно свободно вернуться и уйти
   * через вторую дверь. Обычная секция или "настоящая" (проходная) ветка
   * развилки — всегда false.
   */
  isDeadEnd?: boolean;
  /** Id ворот родительской секции, через которые входят в эту ветку. */
  forkGateId?: string;
  /** Индекс родительской секции (строить ветку, пока игрок у развилки или прошёл ворота). */
  forkParentIndex?: number;
  witches: WitchSpec[];
  bonfires: BonfireSpec[];
  practiceTargets: PracticeTargetSpec[];
  chests: ChestSpec[];
  /** Перпендикулярные боковые тупики-ниши (0..N, обычно 0..1) — см. SideSpurSpec. */
  sideSpurs: SideSpurSpec[];
  grass: ScatterSeed[];
  borderLeft: ScatterSeed[];
  borderRight: ScatterSeed[];
}

export interface WorldSpec {
  sections: SectionSpec[];
  spawnPoint: { x: number; y: number; z: number };
  tower: { x: number; z: number };
}

// Первая секция — узкий «входной шлюз» для мягкого онбординга.
export const FIRST_SECTION_WIDTH = 8;
// Остальные секции — ровно в 3 раза шире (п.доработок: «шире … раза в 3»).
export const SECTION_WIDTH = FIRST_SECTION_WIDTH * 3;
const FIRST_SECTION_LENGTH = { min: 12, max: 18 };
const SECTION_LENGTH = { min: 36, max: 54 }; // 12-18 × 3

/** Максимальный изгиб на стыке секций в рад (~17°). */
const MAX_BEND = 0.3;
/** Потолок накопленного изгиба трассы, чтобы коридор не закручивался в спираль. */
const MAX_YAW = 1.05;
/** Вероятность, что секция закончится развилкой (двумя воротами). */
const FORK_PROBABILITY = 0.45;
/**
 * Вероятность тупика — второй, независимой развилки-варианта, которая
 * проверяется, только если "настоящая" развилка НЕ выпала (см. генератор):
 * итоговый шанс СКРЕСТИТЬ какую-либо из двух дверей = FORK_PROBABILITY +
 * DEADEND_PROBABILITY. Тупик выглядит снаружи как обычная развилка (те же
 * двойные ворота), но одна из двух дверей ведёт в короткий рукав без выхода
 * — открывшему её барьер не запирается за спиной (в отличие от настоящей
 * развилки), можно спокойно вернуться и уйти через вторую дверь.
 */
const DEADEND_PROBABILITY = 0.2;
/** Доля ширины коридора, которую закрывает один барьер при развилке. */
const FORK_GATE_FRACTION = 0.5;
/** Длина параллельных коридоров-веток за развилкой (до схождения в общую секцию). */
const FORK_BRANCH_LENGTH = { min: 22, max: 38 };
/** Длина тупикового рукава — заметно короче настоящей ветки: это бонусный уголок, а не часть пути. */
export const DEADEND_LENGTH = { min: 12, max: 24 };

/**
 * Боковые ниши (перпендикулярные тупики через проём в стене, см. SideSpurSpec):
 * шанс на каждую полноширинную стволовую секцию (обычную ИЛИ схождение J —
 * не на первую и не на подход). Ветки развилки и её собственный тупик сюда
 * не входят — это отдельный, более крупный механизм.
 */
const SIDE_SPUR_PROBABILITY = 0.35;
/** Ширина ниши = ширина проёма в стене родителя. */
export const SIDE_SPUR_WIDTH = 6;
/** Длина рукава ниши — короче даже тупика развилки: это карман на пару шагов, а не отдельная зона. */
export const SIDE_SPUR_LENGTH = { min: 7, max: 13 };
/** Отступ от концов секции (вход/выход/ворота), внутри которого проём не ставим. */
export const SIDE_SPUR_MARGIN = 9;

const TIER_COLORS: Record<number, string> = {
  1: "#3f7d3a", // сочная трава — простые темы
  2: "#356b57", // глубже, спокойнее — темы посложнее
  3: "#3c4f68", // сумеречный оттенок перед финалом
};
const APPROACH_COLOR = "#2c3550";

/**
 * Рукописные правила контента для ПЕРВЫХ ДВУХ секций (онбординг) — здесь
 * указывается ТОЧНОЕ содержимое вместо процедуры из GameState. Массив
 * индексируется по spec.index: INTRO_RULES[0] — секция спавна, INTRO_RULES[1]
 * — вторая. Дальше (включая ветки развилки и J) контент процедурный.
 *
 * Ограничение «по index» корректно: развилка возможна только с index >= 2
 * (forkAllowed исключает первую секцию), поэтому #0/#1 — всегда ствол, и
 * правило не утечёт в ветки.
 *
 * Формы:
 * - `bonfires: { exact: N }` — ровно N костров;
 * - `chests: { exact: N }` — N сундуков, содержимое подберёт процедура
 *   (не собранные страницы книг);
 * - `chests: ChestSpec[]` — сундуки с ТОЧНЫМ содержимым и координатами
 *   (локальные x поперёк, z вдоль оси секции).
 */
const INTRO_RULES: readonly SectionContentRule[] = [
  // #0 — входной шлюз: костёр обучения у входа, сундуков нет.
  { bonfires: { exact: 1 }, chests: [] },
  // #1 — первый «настоящий» коридор: костёр у входа и второй в глубине,
  // один сундук с конкретной страницей книги.
  {
    bonfires: { exact: 2 },
    chests: [{ id: "chest-intro-1", x: 0, z: 24, bookIds: ["mechanics_basics"], pageIds: ["mechanics_acceleration"] }],
  },
];

// --- Простой детерминированный PRNG (mulberry32), чтобы генерация была
// воспроизводимой при известном seed и не зависела от Math.random напрямую ---
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}
function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(randRange(rng, min, max + 1));
}
function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
/** Нормализация угла в (-π, π]. */
function normAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

const BORDER_STYLES: readonly BorderStyle[] = ["bushes", "fence", "mountains"];

/**
 * Уровень барьера: доля от ВСЕГО числа заклинаний, зависящая от сложности
 * секции (tier 1-3). С ростом контента (добавление школ) пороги масштабируются
 * сами — tier/6 от общего числа тем (1/6, 1/3, 1/2 для tier 1/2/3).
 */
function gateRequiredSpells(tier: number, totalSpells: number): number {
  return Math.max(1, Math.min(totalSpells, Math.ceil((totalSpells * tier) / 6)));
}

/** Курс (направление) оси секции в точке localZ вдоль её длины. */
export function yawAt(section: Pick<SectionSpec, "yaw" | "curvature">, localZ: number): number {
  return section.yaw + section.curvature * localZ;
}

/**
 * Перевод локальных координат секции (x — поперёк, z — вдоль оси) в мировые.
 * Секция — дуга ПОСТОЯННОЙ кривизны (curvature=0 — прямая, ровно как раньше):
 * курс в точке localZ равен yawAt(section, localZ), позиция на осевой линии —
 * замкнутая формула дуги окружности (интеграл (sin,cos)(yaw(s)) ds, s=0..localZ).
 * localX откладывается ПЕРПЕНДИКУЛЯРНО оси именно В ТОЧКЕ localZ (локальный
 * репер Френе), поэтому при curvature=0 формула даёт ТОЧНО то же самое, что
 * и старая (проверено формально: dx/ds=sin(yaw(s)), dz/ds=cos(yaw(s)), и
 * значение в s=0 равно start — см. verify_arc_math в истории ревью).
 */
export function localToWorld(
  section: Pick<SectionSpec, "start" | "yaw" | "curvature">,
  localX: number,
  localZ: number
): { x: number; z: number } {
  const c = section.curvature;
  const yaw0 = section.yaw;
  let centerlineX: number;
  let centerlineZ: number;
  if (Math.abs(c) < 1e-9) {
    centerlineX = section.start.x + localZ * Math.sin(yaw0);
    centerlineZ = section.start.z + localZ * Math.cos(yaw0);
  } else {
    const yaw1 = yaw0 + c * localZ;
    centerlineX = section.start.x + (Math.cos(yaw0) - Math.cos(yaw1)) / c;
    centerlineZ = section.start.z + (Math.sin(yaw1) - Math.sin(yaw0)) / c;
  }
  const yawS = yawAt(section, localZ);
  const perpX = Math.cos(yawS);
  const perpZ = -Math.sin(yawS);
  return { x: centerlineX + localX * perpX, z: centerlineZ + localX * perpZ };
}

/** Расстояние от точки до отрезка между двумя произвольными точками (для гейтов-барьеров — они всегда плоские, независимо от кривизны коридора — и для регрессионных тестов). */
export function distPointToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  let t = 0;
  if (lenSq > 1e-12) {
    t = clamp(((px - ax) * dx + (pz - az) * dz) / lenSq, 0, 1);
  }
  const cx = ax + dx * t;
  const cz = az + dz * t;
  return Math.hypot(px - cx, pz - cz);
}

/**
 * Расстояние от точки до ОСИ секции (дуги постоянной кривизны) — используется
 * WorldStreamer.sectionAt() для определения секции игрока. Раньше секции были
 * прямыми, и расстояние до хорды start-end (distPointToSegment) было точным;
 * теперь ось может изгибаться вдоль своей длины, и расстояние до прямой хорды
 * даёт систематическую ошибку в метры на длинных изогнутых секциях (стрела
 * прогиба ~ length*|curvature|/8) — этого достаточно, чтобы спутать соседние
 * секции у стыка, хотя SWITCH_HYSTERESIS в WorldStreamer рассчитан на куда
 * меньший дребезг. Для прямых секций (curvature≈0) — эквивалентно старой
 * формуле через distPointToSegment.
 */
export function distPointToSectionAxis(
  px: number,
  pz: number,
  section: Pick<SectionSpec, "start" | "yaw" | "curvature" | "length">
): number {
  const { curvature, yaw: yaw0, length } = section;
  if (Math.abs(curvature) < 1e-9) {
    const end = localToWorld(section, 0, length);
    return distPointToSegment(px, pz, section.start.x, section.start.z, end.x, end.z);
  }
  // Дуга — часть окружности радиуса 1/curvature с центром C; ближайшая точка
  // ПОЛНОЙ окружности к P лежит строго в направлении C->P, поэтому достаточно
  // найти угол этого направления (= курс дуги в искомой точке), перевести
  // его в параметр s и обрезать в границы [0, length] (если ближайшая точка
  // полной окружности вне дуги — ближайшая точка ДУГИ является одним из её
  // концов, ровно то, что делает clamp).
  const R = 1 / curvature;
  const centerX = section.start.x + Math.cos(yaw0) * R;
  const centerZ = section.start.z - Math.sin(yaw0) * R;
  const vx = px - centerX;
  const vz = pz - centerZ;
  const yawAtNearest = Math.atan2(vz / R, -vx / R);
  let s = normAngle(yawAtNearest - yaw0) / curvature;
  s = clamp(s, 0, length);
  const nearest = localToWorld(section, 0, s);
  return Math.hypot(px - nearest.x, pz - nearest.z);
}

/**
 * Выбор школ-тем для ворот секции. Тематика — «ветки прокачки заклинаний»:
 * чем меньше школа отработана (суммарное мастерство её спеллов) и чем реже она
 * уже назначалась воротам в этом прогоне генерации, тем выше шанс, что очередные
 * ворота отправят игрока именно в неё. Так после выбора ветки следующие ворота
 * переключаются на ещё не отработанные школы.
 */
function pickGateSchools(rng: () => number, gameState: GameState, used: Map<string, number>, count: 1 | 2): string[] {
  // Темой ворот может быть только школа с реальным контентом (спеллами):
  // пустая ветка не даст игроку отработать её у барьера.
  const schools = gameState.getUnlockedSchools().filter((s) => getSpellsBySchool(s.id).length > 0);
  const scored = schools
    .map((s) => {
      const practice = ALL_SPELLS.filter((sp) => sp.school === s.id).reduce((sum, sp) => sum + gameState.getMastery(sp.id), 0);
      const load = used.get(s.id) ?? 0;
      const weight = (1 / (1 + load * 2.5 + practice * 0.5)) * (0.8 + rng() * 0.4);
      return { id: s.id, weight };
    })
    .sort((a, b) => b.weight - a.weight);

  const chosen = scored.slice(0, count).map((s) => s.id);
  for (const id of chosen) used.set(id, (used.get(id) ?? 0) + 1);
  return chosen;
}

/**
 * Назначает выходные ворота секции: forceFork=true — принудительно развилка
 * (двое ворот). oneWay управляет ТОЛЬКО односторонним блоком за барьерами
 * развилки (см. EnergyGate) — сама раскладка (ширина, x=±w/4) не зависит от
 * него. У настоящей развилки oneWay=true (закрепляет выбор школы); у
 * развилки-тупика oneWay=false — ни одна из двух дверей не запирается,
 * тупик задуман как свободно посещаемый бонус, а не выбор с последствиями.
 */
function assignExitGates(
  spec: SectionSpec,
  rng: () => number,
  gameState: GameState,
  used: Map<string, number>,
  forceFork: boolean,
  oneWay: boolean = true
): void {
  const fork = forceFork;
  const schools = pickGateSchools(rng, gameState, used, fork ? 2 : 1);
  const required = gateRequiredSpells(spec.tier, ALL_SPELLS.length);

  if (fork) {
    const gateWidth = spec.width * FORK_GATE_FRACTION - 0.3;
    spec.gates = [
      { id: `gate-${spec.index}-a`, requiredSpells: required, schoolId: schools[0] ?? null, x: -spec.width / 4, width: gateWidth, fork: oneWay },
      { id: `gate-${spec.index}-b`, requiredSpells: required, schoolId: schools[1] ?? schools[0] ?? null, x: spec.width / 4, width: gateWidth, fork: oneWay },
    ];
  } else {
    spec.gates = [{ id: `gate-${spec.index}`, requiredSpells: required, schoolId: schools[0] ?? null, x: 0, width: spec.width - 0.4 }];
  }
}

/**
 * Процедурная генерация коридора (п.5 ТЗ + доработки): каждый запуск с новым
 * seed даёт другое число и длину секций, другую расстановку ведьм и декора.
 *
 * Доработки генерации:
 * - Первая секция — узкий шлюз БЕЗ ведьм: мягкий вход в игровой процесс.
 * - Остальные секции в 3 раза шире и длиннее, трасса изгибается (случайные
 *   повороты yaw со сглаживанием и потолком, чтобы не закручивалась).
 * - Иногда секция заканчивается ДВУМЯ воротами-развилкой на разные ветки
 *   прокачки (школы); следующая секция делится средней стеной-разделителем.
 * - Тематика ворот = школа; выбирается по принципу «наименее отработанных»
 *   веток с анти-повтором внутри прогона.
 * - Трасса изгибается ПЛАВНО: изгиб — не мгновенный поворот на стыке, а
 *   постоянная кривизна вдоль всей длины секции (curvature) — соседние
 *   секции всегда встречаются с равным курсом, без излома и без диска-заплатки.
 */
export function generateWorld(gameState: GameState, seed: number = Date.now()): WorldSpec {
  const rng = mulberry32(seed);
  const mainSectionCount = randInt(rng, 5, 7);
  const gateSchoolUsage = new Map<string, number>();

  const sections: SectionSpec[] = [];
  let cursor = { x: 0, z: 0 }; // мировая точка конца текущего коридора
  let yaw = 0;
  let specIndex = 0;
  let prevSpec: SectionSpec | null = null;
  let witchCounter = 0;
  let chestCounter = 0;
  const nextWitchId = (): string => `witch-${witchCounter++}`;
  const nextChestId = (): string => `chest-${chestCounter++}`;
  /** Конструктор контента секций: единый источник сущностей/декора (rng-поток общий с генератором). */
  const contentBuilder = new SectionContentBuilder(rng, gameState, nextWitchId, nextChestId);

  /** Базовая секция (без сущностей). */
  const makeSection = (
    index: number,
    tier: number,
    width: number,
    length: number,
    start: { x: number; z: number },
    end: { x: number; z: number },
    sectionYaw: number,
    curvature: number,
    prev: SectionSpec | null
  ): SectionSpec => {
    return {
      index,
      tier,
      color: TIER_COLORS[tier] ?? TIER_COLORS[3],
      borderStyle: pick(rng, BORDER_STYLES),
      length,
      width,
      start,
      end,
      yaw: sectionYaw,
      curvature,
      gates: [],
      partitionDepth: 0,
      prevWidth: prev ? prev.width : 0,
      prevEnd: prev ? { x: prev.end.x, z: prev.end.z } : { x: 0, z: 0 },
      witches: [],
      bonfires: [],
      practiceTargets: [],
      chests: [],
      sideSpurs: [],
      grass: [],
      borderLeft: [],
      borderRight: [],
    };
  };

  /**
   * Заполняет секцию сущностями и декором (все координаты локальные) через
   * «конструктор секций» (SectionContentBuilder). Для первых двух секций
   * применяются рукописные интро-правила (INTRO_RULES — точное содержимое),
   * для остальных — правило по умолчанию, выведенное из состояния игры:
   * «что игроку нужно в следующей секции» (слабые темы для ведьм, не
   * собранные страницы для сундуков).
   */
  const fillSection = (spec: SectionSpec, isFirst: boolean): void => {
    const intro = INTRO_RULES[spec.index];
    contentBuilder.apply(
      spec,
      intro ?? SectionContentBuilder.defaultRule(gameState, { tier: spec.tier, isFirst })
    );
  };

  let spurCounter = 0;
  /**
   * Пытается пристроить к секции боковую нишу-тупик (см. SideSpurSpec).
   * Вызывается ПОСЛЕ fillSection — ниша не часть процедуры контента секции
   * (SectionContentBuilder про неё не знает), а самостоятельная надстройка
   * поверх уже готового spec: свой сундук+ведьма подбираются отдельно
   * (buildSideSpurContent), а проём вырезается из УЖЕ сгенерированного
   * бордюра соответствующей стороны, чтобы декор (кусты/забор/скалы) не
   * закрывал собой проход в нишу.
   */
  const maybeAddSideSpur = (spec: SectionSpec): void => {
    if (rng() >= SIDE_SPUR_PROBABILITY) return;
    if (spec.length <= SIDE_SPUR_MARGIN * 2 + 2) return;

    const doorZ = randRange(rng, SIDE_SPUR_MARGIN, spec.length - SIDE_SPUR_MARGIN);
    const side: "left" | "right" = rng() < 0.5 ? "left" : "right";
    // Нечем наградить (весь лор собран) или некому напасть (школы/темы
    // недоступны на этом tier) — ниша в этот раз не появляется, чтобы не
    // ставить пустой сундук или ведьму без осмысленной темы атаки.
    const content = contentBuilder.buildSideSpurContent(spec.tier);
    if (!content) return;

    const spurLength = randRange(rng, SIDE_SPUR_LENGTH.min, SIDE_SPUR_LENGTH.max);
    const half = SIDE_SPUR_WIDTH / 2;
    const doorX = side === "right" ? spec.width / 2 : -spec.width / 2;
    const doorWorld = localToWorld(spec, doorX, doorZ);
    // Курс ниши — курс родителя В ТОЧКЕ проёма, повёрнутый на ±90°: рукав
    // уходит СТРОГО ПЕРПЕНДИКУЛЯРНО коридору, а не продолжает его направление
    // (в отличие от веток настоящей развилки/её тупика).
    const spurYaw = yawAt(spec, doorZ) + (side === "right" ? Math.PI / 2 : -Math.PI / 2);

    spec.sideSpurs.push({
      id: `spur-${spurCounter++}`,
      side,
      start: doorWorld,
      yaw: spurYaw,
      width: SIDE_SPUR_WIDTH,
      length: spurLength,
      doorZ,
      witch: {
        id: nextWitchId(),
        x: randRange(rng, -(half - 1), half - 1),
        z: clamp(spurLength * 0.4, 2, spurLength - 3),
        spellId: content.spellId,
      },
      chest: {
        id: nextChestId(),
        x: randRange(rng, -(half - 1), half - 1),
        z: spurLength - 1.6,
        bookIds: [content.book.bookId],
        pageIds: content.book.pageIds,
      },
    });

    // Проём режем из уже сгенерированного бордюра этой стороны — иначе кусты
    // /забор/скалы будут визуально торчать прямо в дверном проёме ниши.
    const gapMin = doorZ - half - 0.6;
    const gapMax = doorZ + half + 0.6;
    if (side === "left") {
      spec.borderLeft = spec.borderLeft.filter((s) => s.z < gapMin || s.z > gapMax);
    } else {
      spec.borderRight = spec.borderRight.filter((s) => s.z < gapMin || s.z > gapMax);
    }
  };

  let worldCount = 0; // стволовых секций (parent + схождения J)
  while (worldCount < mainSectionCount) {
    const isFirst = worldCount === 0;
    const last = worldCount === mainSectionCount - 1;
    const width = isFirst ? FIRST_SECTION_WIDTH : SECTION_WIDTH;
    const length = isFirst
      ? randRange(rng, FIRST_SECTION_LENGTH.min, FIRST_SECTION_LENGTH.max)
      : randRange(rng, SECTION_LENGTH.min, SECTION_LENGTH.max);
    const tier = Math.min(3, Math.floor((worldCount / mainSectionCount) * 3) + 1);

    // Курс, с которым секция НАЧИНАЕТСЯ, — курс, на котором закончилась
    // предыдущая (см. обновление `yaw` в конце итерации): стык без излома.
    const startYaw = yaw;
    let curvature = 0;
    if (!isFirst) {
      // Тот же случайный изгиб, что и раньше (тот же диапазон MAX_BEND и
      // потолок MAX_YAW на итоговый курс) — но теперь размазанный ПОСТОЯННОЙ
      // кривизной по всей длине секции, а не приложенный мгновенно на стыке.
      // Секция становится дугой окружности вместо прямого отрезка — коридор
      // поворачивает плавно, и дискового «клина»-заплатки на стыке (см.
      // историю SectionChunk.buildJointPatch) больше не нужно: соседние
      // секции всегда встречаются с РАВНЫМ курсом по построению.
      const targetEndYaw = clamp(startYaw + randRange(rng, -MAX_BEND, MAX_BEND), -MAX_YAW, MAX_YAW);
      curvature = (targetEndYaw - startYaw) / length;
    }

    const end = localToWorld({ start: cursor, yaw: startYaw, curvature }, 0, length);
    const parent = makeSection(specIndex, tier, width, length, { x: cursor.x, z: cursor.z }, end, startYaw, curvature, prevSpec);
    yaw = startYaw + curvature * length; // курс в конце секции = курс начала следующей
    fillSection(parent, isFirst);
    if (!isFirst) maybeAddSideSpur(parent);

    const forkAllowed =
      !isFirst &&
      !last &&
      gameState.getUnlockedSchools().filter((s) => getSpellsBySchool(s.id).length > 0).length >= 2;
    // Один бросок на оба варианта: сперва зона настоящей развилки, затем
    // (если не попали) зона тупика — суммарный шанс "что-то за двойными
    // воротами" = FORK_PROBABILITY + DEADEND_PROBABILITY, без двух отдельных
    // rng()-вызовов, чтобы не сбивать распределение остальных бросков.
    const roll = forkAllowed ? rng() : 1;
    const fork = roll < FORK_PROBABILITY;
    const deadEnd = !fork && roll < FORK_PROBABILITY + DEADEND_PROBABILITY;

    if (fork || deadEnd) {
      assignExitGates(parent, rng, gameState, gateSchoolUsage, true, !deadEnd);

      // --- Две ПАРАЛЛЕЛЬНЫЕ ветки за двойными воротами (см. ТЗ): каждая
      // половинка коридора шириной w/2 идёт своим рукавом. У настоящей
      // развилки обе сходятся в J на одной кромке; у тупика — только ОДНА
      // (случайно a или b) доходит до J, вторая — короткий рукав без выхода
      // (см. isDeadEnd на SectionSpec). ---
      const branchLen = randRange(rng, FORK_BRANCH_LENGTH.min, FORK_BRANCH_LENGTH.max);
      const dirX = Math.sin(yaw);
      const dirZ = Math.cos(yaw);
      const perpX = Math.cos(yaw);
      const perpZ = -Math.sin(yaw);
      const off = SECTION_WIDTH / 4;
      const branchTier = Math.min(3, tier + 1);
      // Какая из двух дверей — тупик (если это вообще тупик, а не развилка).
      const deadSlot: "a" | "b" | null = deadEnd ? (rng() < 0.5 ? "a" : "b") : null;

      // ВАЖНО: ветки и J начинаются у КОНЦА родителя (там, где стоят её
      // ворота — см. GateSpec/"Выходные ворота ... стоят на её КОНЦЕ"),
      // а не у cursor: на этом шаге цикла cursor всё ещё указывает на
      // НАЧАЛО parent (переменная обновляется только в самом низу цикла).
      // Использование cursor вместо end сажало ветки и схождение J поверх
      // собственного коридора родителя (совпадающие/перекрывающиеся оси на
      // добрый десяток метров) — отсюда и «мир перестраивается под ногами»
      // возле развилок, и накладывающиеся полы/стены в этой зоне.
      // Ветки и схождение остаются ПРЯМЫМИ (curvature=0): чтобы обе ветки
      // реально были параллельны и сошлись в одну общую кромку J, их изгиб
      // должен быть согласован (концентрические дуги с чуть разной кривизной
      // для внутренней/внешней "полосы" — иначе расстояние между ними на
      // длине branchLen "плывёт"). Отдельная, более тяжёлая задача — см.
      // ревью; сама развилка от этого не выглядит хуже, чем раньше (стыки
      // parent->ветки->J и без того были прямыми: yaw тут не менялся и в
      // старой версии).
      const mkBranch = (branch: "a" | "b", sign: number, gateId: string): SectionSpec => {
        const isDead = branch === deadSlot;
        // Тупик короче настоящей ветки (это бонусный уголок, не часть пути)
        // и не сложнее самой развилки (branchTier — только для проходных).
        const branchLength = isDead ? randRange(rng, DEADEND_LENGTH.min, DEADEND_LENGTH.max) : branchLen;
        const thisTier = isDead ? tier : branchTier;
        const start = { x: end.x - perpX * off * sign, z: end.z - perpZ * off * sign };
        const branchEnd = { x: start.x + dirX * branchLength, z: start.z + dirZ * branchLength };
        const spec = makeSection(specIndex + 1, thisTier, SECTION_WIDTH / 2, branchLength, start, branchEnd, yaw, 0, parent);
        spec.forkBranch = branch;
        spec.forkGateId = gateId;
        spec.forkParentIndex = parent.index;
        spec.isDeadEnd = isDead;
        // Тупик остаётся без выходных ворот (spec.gates — [] по умолчанию из
        // makeSection): дальше пути нет, только назад через тот же барьер
        // (он не односторонний — см. assignExitGates(..., oneWay) выше).
        fillSection(spec, false);
        return spec;
      };
      const branchA = mkBranch("a", 1, parent.gates[0].id);
      const branchB = mkBranch("b", -1, parent.gates[1].id);
      // J стыкуется с ПРОДОЛЖАЮЩЕЙ веткой — при настоящей развилке это
      // произвольно branchA (обе ветки геометрически идентичны по ширине и
      // курсу, для "ушей"-бордюра в SectionChunk неважно, какую взять); при
      // тупике — обязательно та, что НЕ тупик (тупиковая до J не дотягивается).
      const continuingBranch = deadSlot === "a" ? branchB : branchA;

      // Общая секция-схождение: вход J — кромка на конце ПРОДОЛЖАЮЩЕЙ ветки.
      const jStart = { x: end.x + dirX * branchLen, z: end.z + dirZ * branchLen };
      const jLength = randRange(rng, SECTION_LENGTH.min, SECTION_LENGTH.max);
      const jEnd = localToWorld({ start: jStart, yaw, curvature: 0 }, 0, jLength);
      const join = makeSection(specIndex + 2, tier, SECTION_WIDTH, jLength, jStart, jEnd, yaw, 0, continuingBranch);
      fillSection(join, false);
      maybeAddSideSpur(join);

      sections.push(parent, branchA, branchB, join);
      prevSpec = join;
      cursor = jEnd;
      specIndex += 3;
      worldCount += 2; // parent + J — две стволовые позиции
    } else {
      if (!last) assignExitGates(parent, rng, gameState, gateSchoolUsage, false);
      sections.push(parent);
      prevSpec = parent;
      cursor = end;
      specIndex += 1;
      worldCount += 1;
    }
  }

  // --- Финальная секция — спокойный подход к башне, без врагов, без выхода ---
  const approachStartYaw = yaw;
  const approachTargetEndYaw = clamp(approachStartYaw + randRange(rng, -MAX_BEND, MAX_BEND), -MAX_YAW, MAX_YAW);
  const approachLength = randRange(rng, SECTION_LENGTH.min, SECTION_LENGTH.max);
  const approachCurvature = (approachTargetEndYaw - approachStartYaw) / approachLength;
  const approachStart = { x: cursor.x, z: cursor.z };
  const approachEnd = localToWorld(
    { start: approachStart, yaw: approachStartYaw, curvature: approachCurvature },
    0,
    approachLength
  );
  if (prevSpec) {
    // Вход в подход гейтится одиночным барьером от последней боевой секции.
    const schools = pickGateSchools(rng, gameState, gateSchoolUsage, 1);
    prevSpec.gates = [
      {
        id: "gate-approach",
        requiredSpells: gateRequiredSpells(prevSpec.tier, ALL_SPELLS.length),
        schoolId: schools[0] ?? null,
        x: 0,
        width: prevSpec.width - 0.4,
      },
    ];
  }
  const approach = makeSection(
    specIndex,
    0,
    SECTION_WIDTH,
    approachLength,
    approachStart,
    approachEnd,
    approachStartYaw,
    approachCurvature,
    prevSpec
  );
  approach.color = APPROACH_COLOR;
  // Подход — спокойная зона: без сущностей и сундуков, только трава и бордюры.
  contentBuilder.apply(approach, {
    bonfires: { exact: 0 },
    witches: { exact: 0 },
    practiceTargets: { exact: 0 },
    chests: [],
  });
  sections.push(approach);

  const spawnLocal = localToWorld(sections[0], 0, 2.5);
  const towerLocal = localToWorld(approach, 0, approachLength + 2);

  logWorldSpec({ sections, spawnPoint: { x: spawnLocal.x, y: 1, z: spawnLocal.z }, tower: { x: towerLocal.x, z: towerLocal.z } }, seed);

  return {
    sections,
    spawnPoint: { x: spawnLocal.x, y: 1, z: spawnLocal.z },
    tower: { x: towerLocal.x, z: towerLocal.z },
  };
}

/**
 * Логирование сгенерированного мира: секции + барьеры на их концах.
 * Секции нумеруются общим индексом `spec.index`, барьеры привязаны к
 * `gate.id`. Двойные ворота развилки печатаются рядом, чтобы при баге
 * «внезапно появляются/исчезают плоскости» сразу было видно ожидаемое
 * число барьеров и их параметры (x/width/yaw/школа).
 */
function logWorldSpec(world: WorldSpec, seed: number): void {
  if (typeof console === "undefined") return;
  const tag = "[world-gen]";
  // eslint-disable-next-line no-console
  console.groupCollapsed(`${tag} seed=${seed} sections=${world.sections.length} spawn=(${world.spawnPoint.x.toFixed(2)},${world.spawnPoint.z.toFixed(2)}) tower=(${world.tower.x.toFixed(2)},${world.tower.z.toFixed(2)})`);
  for (const s of world.sections) {
    const gates = s.gates
      .map(
        (g) =>
          `id=${g.id} school=${g.schoolId ?? "-"} req=${g.requiredSpells} x=${g.x.toFixed(2)} w=${g.width.toFixed(2)}${g.fork ? " fork" : ""}`
      )
      .join(" | ");
    // eslint-disable-next-line no-console
    console.log(
      `${tag} #${s.index} tier=${s.tier} "${s.color}" border=${s.borderStyle} yaw=${s.yaw.toFixed(3)} curvature=${s.curvature.toFixed(4)} start=(${s.start.x.toFixed(2)},${s.start.z.toFixed(2)}) end=(${s.end.x.toFixed(2)},${s.end.z.toFixed(2)}) width=${s.width} length=${s.length.toFixed(2)} forkBranch=${s.forkBranch ?? "-"}${s.isDeadEnd ? "(dead)" : ""} partitionDepth=${s.partitionDepth.toFixed(2)} gates=[${gates || "-"}] entities=w${s.witches.length}/b${s.bonfires.length}/p${s.practiceTargets.length}/c${s.chests.length}/spur${s.sideSpurs.length}`
    );
  }
  // eslint-disable-next-line no-console
  console.groupEnd();
}