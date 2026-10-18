/**
 * witchBrain.ts — «мозг» ведьмы: чистая state machine без зависимостей от Babylon.
 *
 * Мозг ничего не двигает сам: каждый кадр он получает фактическое положение
 * ведьмы и данные об игроке и возвращает желаемую скорость и курс. Саму
 * ходьбу (с коллизиями со стенами) делает Witch.updateAi(). Благодаря этому
 * всю логику стелса можно прогнать в Node без сцены (scripts/test-witch-ai.ts).
 *
 * Состояния:
 *   idle   — стоит, время от времени оглядывается;
 *   wander — медленно прогуливается недалеко от «дома» (точки спавна у сундука);
 *   notice — только что заметила игрока: замирает и разворачивается к нему
 *            (у каждой ведьмы своя скорость реакции) — шанс успеть спрятаться;
 *   chase  — медленно идёт к игроку (скорость «плавает», ведьма виляет и порой
 *            останавливается; через случайное время устаёт);
 *   search — потеряла игрока из виду (куст/дерево/стена/бегство): иногда оглядывается,
 *            идёт к месту пропажи (иногда — туда, куда он бежал), обходит это место
 *            и пару секунд бродит/стоит рядом;
 *   watch  — игрок ушёл за границу её секции (или за поводок): стоит и смотрит, пока
 *            его видно, но не вечно; потеряв из виду — теряет интерес быстрее;
 *   return — потеряла интерес и возвращается домой.
 *
 * Зрение: конус (не очень широкий) + дальность + прямая видимость (стены, кусты,
 * деревья — это решает вызывающий через lineOfSight) + игрок не спрятан в кусте.
 *
 * Углы (yaw) — как в остальной игре: 0 = +Z, направление взгляда (sin yaw, cos yaw).
 */

export type WitchAiState = "idle" | "wander" | "notice" | "chase" | "search" | "watch" | "return";

export interface WitchAiConfig {
  /** Полный угол обзора, рад (не очень широкий). */
  fov: number;
  /** Дальность обзора, м. */
  viewRange: number;
  /** Пока ведьма уже следит — она «держит» игрока на большей дистанции/угле (гистерезис). */
  trackRangeMul: number;
  trackFovMul: number;
  /** Радиус прогулки вокруг дома, м. */
  wanderRadius: number;
  wanderSpeed: number;
  /** Базовая скорость погони — намного ниже скорости игрока (6.5 м/с), от неё легко убежать. */
  chaseSpeed: number;
  returnSpeed: number;
  /** Сколько стоит на месте между прогулками, с. */
  idleMin: number;
  idleMax: number;
  /** Шанс после стояния пойти гулять (иначе ещё постоит/оглянется). */
  wanderChance: number;

  /** Пауза узнавания: сколько ведьма замирает, заметив игрока, с (умножается на характер). */
  reactionMin: number;
  reactionMax: number;
  /** Если ведьма уже встревожена (искала/возвращалась) — реакция короче в столько раз. */
  reactionAlertedMul: number;
  /** Скорость «плавает» вокруг базовой: новый множитель каждые N секунд, плавно. */
  wobbleMin: number;
  wobbleMax: number;
  wobbleEveryMin: number;
  wobbleEveryMax: number;
  /** Остановка посреди погони, с. */
  hesitateMin: number;
  hesitateMax: number;
  /** Через сколько секунд непрерывной погони ведьма устаёт (множится на терпение), с. */
  chaseBudgetMin: number;
  chaseBudgetMax: number;

  /** Поиск: сколько бродит у места пропажи игрока, с (множится на терпение). */
  searchLingerMin: number;
  searchLingerMax: number;
  /** Кольцо, по которому бродит у места пропажи (от точки, где игрок исчез), м. */
  searchRingMin: number;
  searchRingMax: number;
  /** Шанс сначала оглядеться на месте, а уже потом идти к точке пропажи. */
  scanChance: number;
  scanMin: number;
  scanMax: number;
  /** Насколько далеко «вперёд по ходу бега игрока» она может пойти (если угадывает направление), м. */
  predictLeadMin: number;
  predictLeadMax: number;
  /** При брожении у места пропажи: шанс вместо шага постоять и оглянуться. */
  lingerPauseChance: number;
  pauseMin: number;
  pauseMax: number;

  /** Наблюдение (игрок за границей секции/поводка): сколько стоит и смотрит, с (множится на терпение). */
  watchMin: number;
  watchMax: number;
  /** Подошёл ближе — спровоцировал: ведьма снова бросается (если игрок в её секции). */
  provokeDistance: number;

  /** Подходит к игроку не ближе этого (дальше — триггер боя, он снаружи). */
  chaseStopDistance: number;
  /** Дальше этого от дома погоню бросает (но только если игрок не рядом). */
  leash: number;
  /** Скорость поворота, рад/с. */
  turnRate: number;
  /** Сколько ждёт, прежде чем решить, что потеряла игрока (мерцание LOS), с. */
  loseGrace: number;
  /** Сколько без реального продвижения считается «застряла», с. */
  stuckTime: number;
}

export const DEFAULT_WITCH_AI: WitchAiConfig = {
  fov: (70 * Math.PI) / 180,
  viewRange: 11,
  trackRangeMul: 1.25,
  trackFovMul: 1.6,
  wanderRadius: 2.2,
  wanderSpeed: 0.9,
  chaseSpeed: 2.1,
  returnSpeed: 1.6,
  idleMin: 2.5,
  idleMax: 6,
  wanderChance: 0.6,

  reactionMin: 0.2,
  reactionMax: 0.8,
  reactionAlertedMul: 0.35,
  wobbleMin: 0.75,
  wobbleMax: 1.25,
  wobbleEveryMin: 0.7,
  wobbleEveryMax: 2.0,
  hesitateMin: 0.25,
  hesitateMax: 0.9,
  chaseBudgetMin: 9,
  chaseBudgetMax: 24,

  searchLingerMin: 2,
  searchLingerMax: 3.2,
  searchRingMin: 1.8,
  searchRingMax: 3,
  scanChance: 0.5,
  scanMin: 0.5,
  scanMax: 1.4,
  predictLeadMin: 2.5,
  predictLeadMax: 4.5,
  lingerPauseChance: 0.4,
  pauseMin: 0.4,
  pauseMax: 1.1,

  watchMin: 3.5,
  watchMax: 8,
  provokeDistance: 4.5,

  chaseStopDistance: 1.6,
  leash: 16,
  turnRate: 3.2,
  loseGrace: 0.4,
  stuckTime: 0.9,
};

/**
 * Характер ведьмы: разыгрывается один раз при создании, поэтому ведьмы одной и
 * той же секции ведут себя по-разному (одна зорче, другая медлительнее и т.д.).
 */
export interface WitchTraits {
  /** Множитель дальности обзора. */
  viewRangeMul: number;
  /** Множитель угла обзора. */
  fovMul: number;
  /** Множитель скорости погони. */
  chaseSpeedMul: number;
  /** Множитель паузы узнавания (больше — реагирует медленнее). */
  reactionMul: number;
  /** Множитель терпения: время поиска, наблюдения и «запас сил» в погоне. */
  patience: number;
  /** Амплитуда виляния траектории в погоне, рад. */
  weaveAmp: number;
  /** Частота виляния, Гц. */
  weaveFreq: number;
  /** Склонность останавливаться посреди погони (вероятность в секунду). */
  hesitation: number;
  /** Шанс, что она угадает, куда убежал игрок, и пойдёт «вперёд по ходу». */
  predictChance: number;
}

/** Без случайностей: для тестов, где важны точные тайминги. */
export const NEUTRAL_TRAITS: WitchTraits = {
  viewRangeMul: 1,
  fovMul: 1,
  chaseSpeedMul: 1,
  reactionMul: 1,
  patience: 1,
  weaveAmp: 0,
  weaveFreq: 1,
  hesitation: 0,
  predictChance: 0,
};

/** Границы, из которых разыгрывается характер. */
export const TRAIT_RANGES = {
  viewRangeMul: [0.88, 1.15],
  fovMul: [0.85, 1.2],
  chaseSpeedMul: [0.8, 1.25],
  reactionMul: [0.7, 1.4],
  patience: [0.7, 1.5],
  // Боковое смещение ≈ v·amp/(2π·f): от почти прямой (0.05 м) до заметной «змейки» (~0.75 м).
  weaveAmp: [0.1, 0.55],
  weaveFreq: [0.25, 0.7],
  hesitation: [0, 0.35],
  predictChance: [0.15, 0.7],
} as const;

export interface WitchAiInput {
  /** Фактическое положение ведьмы (после коллизий прошлого кадра). */
  x: number;
  z: number;
  playerX: number;
  playerZ: number;
  /** Игрок сидит в кусте — ведьмы его не видят. */
  playerHidden: boolean;
  /** Умеет ли ведьма вообще замечать игрока (враждебная; не friendly). */
  canDetect: boolean;
  /**
   * Игрок в той же секции, что и ведьма. Ведьмы не покидают свою секцию: когда игрок
   * ушёл за границу, погоня превращается в наблюдение (состояние watch).
   */
  playerInTerritory: boolean;
  /** Прямая видимость до игрока (стены/кусты/деревья). Вызывается лениво — только если конус/дальность прошли. */
  lineOfSight: () => boolean;
}

export interface WitchAiOutput {
  /** Желаемая скорость, м/с, в мировых XZ. */
  vx: number;
  vz: number;
  /** Курс корпуса, рад. */
  yaw: number;
  state: WitchAiState;
}

type SearchPhase = "scan" | "approach" | "linger";
type Point = { x: number; z: number };

const TWO_PI = Math.PI * 2;
/** Сколько секунд ведьма не замечает игрока после того, как застряла в погоне. */
const STUCK_GIVE_UP_SECONDS = 4;
/** Игрок бежит быстрее этого — считаем, что у него есть направление (для «угадывания»). */
const MIN_PREDICT_SPEED = 1.5;
/** Потерявшая из виду ведьма теряет интерес в столько раз быстрее при наблюдении. */
const WATCH_BLIND_RATE = 2.5;

function wrapAngle(a: number): number {
  let r = a % TWO_PI;
  if (r > Math.PI) r -= TWO_PI;
  if (r < -Math.PI) r += TWO_PI;
  return r;
}

export class WitchBrain {
  public state: WitchAiState = "idle";
  public yaw: number;
  public readonly traits: WitchTraits;

  private readonly cfg: WitchAiConfig;
  private timer = 0;
  private lookYaw: number;
  private lookTimer = 0;
  private target: Point | null = null;
  private lastSeen: Point | null = null;
  private lostHidden = false;
  private searchAnchor: Point | null = null;
  private searchPhase: SearchPhase = "approach";
  private pauseTimer = 0;
  private loseTimer = 0;
  private ignoreTimer = 0;

  // Погоня: «живость».
  private chaseBudget = 0;
  private wobble = 1;
  private wobbleTarget = 1;
  private wobbleTimer = 0;
  private hesitateTimer = 0;
  private weavePhase = 0;
  private chaseClock = 0;

  // Скорость игрока (сглаженная) — для «угадывания» направления бегства.
  private prevPX: number | null = null;
  private prevPZ = 0;
  private pvx = 0;
  private pvz = 0;

  // Детектор «застряла в стене/упёрлась»: сравниваем фактический сдвиг с заказанным.
  private prevX: number | null = null;
  private prevZ = 0;
  private prevSpeed = 0;
  private stuckTimer = 0;
  private lastInp: WitchAiInput | null = null;

  constructor(
    public readonly homeX: number,
    public readonly homeZ: number,
    initialYaw: number,
    private readonly rng: () => number = Math.random,
    cfg: Partial<WitchAiConfig> = {},
    traits?: Partial<WitchTraits>
  ) {
    this.cfg = { ...DEFAULT_WITCH_AI, ...cfg };
    this.traits = { ...this.rollTraits(), ...traits };
    this.yaw = initialYaw;
    this.lookYaw = initialYaw;
    this.startIdle();
  }

  public get config(): Readonly<WitchAiConfig> {
    return this.cfg;
  }

  /** Тревожное состояние для маркера над головой. */
  public get alert(): "none" | "notice" | "search" | "chase" {
    switch (this.state) {
      case "chase":
        return "chase";
      case "notice":
        return "notice";
      case "search":
      case "watch":
        return "search";
      default:
        return "none";
    }
  }

  /** Куда ведьма идёт искать игрока (для тестов и отладки); null вне поиска. */
  public get searchPoint(): Readonly<{ x: number; z: number }> | null {
    return this.state === "search" ? this.searchAnchor : null;
  }

  /** Ведьма встревожена (заметила игрока и ещё не успокоилась): ей важно, где он. */
  public get alerted(): boolean {
    return this.state === "notice" || this.state === "chase" || this.state === "search" || this.state === "watch";
  }

  /**
   * Ведьма «отцепилась» (дуэль проиграна/отступление): идёт домой и
   * `ignoreSeconds` секунд не замечает игрока — иначе она тут же снова бы
   * к нему прицепилась и бой перезапускался бы бесконечно.
   */
  public disengage(ignoreSeconds: number): void {
    this.ignoreTimer = Math.max(this.ignoreTimer, ignoreSeconds);
    this.lastSeen = null;
    this.startReturn();
  }

  public tick(dt: number, inp: WitchAiInput): WitchAiOutput {
    if (!(dt > 0)) return this.output(0, 0);
    const cfg = this.cfg;

    this.lastInp = inp;
    this.ignoreTimer = Math.max(0, this.ignoreTimer - dt);
    this.trackPlayer(dt, inp);
    this.updateStuck(dt, inp.x, inp.z);

    // Потеряла способность замечать (стала дружелюбной) — следить больше не может.
    if (!inp.canDetect && this.alerted) {
      this.lastSeen = null;
      this.startReturn();
    }

    // Чужая секция интересна только уже встревоженной ведьме (она ждёт и смотрит);
    // спокойная ведьма не реагирует на тех, кто за границей её территории.
    const interested = inp.playerInTerritory || this.alerted;
    const sees = inp.canDetect && this.ignoreTimer <= 0 && interested && this.canSee(inp);

    switch (this.state) {
      case "idle": {
        if (sees) return this.onSpotted(inp, dt, 1);
        this.turnToward(this.lookYaw, dt, 0.6);
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.distToHome(inp) > cfg.wanderRadius * 1.5) {
            this.startReturn();
          } else if (this.rng() < cfg.wanderChance && this.pickWanderTarget(inp)) {
            this.state = "wander";
            this.timer = 8; // страховка от бесконечной прогулки
          } else {
            this.startIdle();
          }
        }
        return this.output(0, 0);
      }

      case "wander": {
        if (sees) return this.onSpotted(inp, dt, 1);
        this.timer -= dt;
        if (!this.target || this.timer <= 0 || this.reached(inp, this.target, 0.25)) {
          this.startIdle();
          return this.output(0, 0);
        }
        return this.walkTo(inp, this.target, cfg.wanderSpeed, dt);
      }

      case "notice": {
        if (!inp.playerInTerritory) return this.startWatch(inp, dt);
        if (sees || !this.lastSeen) {
          this.lastSeen = { x: inp.playerX, z: inp.playerZ };
          if (sees) this.lostHidden = false;
        }
        this.turnToward(Math.atan2(this.lastSeen.x - inp.x, this.lastSeen.z - inp.z), dt, 1.6);
        this.timer -= dt;
        if (this.timer <= 0) {
          if (sees) {
            this.startChase();
          } else {
            // Пока она реагировала, игрок скрылся — идёт посмотреть, куда он делся.
            this.lostHidden = inp.playerHidden;
            this.startSearch(inp);
          }
        }
        return this.output(0, 0);
      }

      case "chase":
        return this.tickChase(dt, inp, sees);

      case "search": {
        if (sees) return this.onSpotted(inp, dt, cfg.reactionAlertedMul);
        return this.tickSearch(dt, inp);
      }

      case "watch": {
        // Подошёл близко (и он в её секции) — это уже провокация: снова гонится.
        const dPlayer = Math.hypot(inp.playerX - inp.x, inp.playerZ - inp.z);
        if (sees && inp.playerInTerritory && dPlayer <= cfg.provokeDistance) {
          return this.startNoticeFrom(inp, cfg.reactionAlertedMul);
        }
        if (sees) this.lastSeen = { x: inp.playerX, z: inp.playerZ };
        if (this.lastSeen) this.turnToward(Math.atan2(this.lastSeen.x - inp.x, this.lastSeen.z - inp.z), dt, 1.2);
        // Пока видит игрока — ждёт; потеряла из виду — интерес гаснет быстрее.
        this.timer -= dt * (sees ? 1 : WATCH_BLIND_RATE);
        if (this.timer <= 0) {
          this.lastSeen = null;
          this.startReturn();
        }
        return this.output(0, 0);
      }

      case "return": {
        if (sees) return this.onSpotted(inp, dt, cfg.reactionAlertedMul);
        const home = { x: this.homeX, z: this.homeZ };
        if (this.reached(inp, home, 0.35)) {
          this.startIdle();
          return this.output(0, 0);
        }
        return this.walkTo(inp, home, cfg.returnSpeed, dt);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Погоня и поиск
  // --------------------------------------------------------------------------

  private tickChase(dt: number, inp: WitchAiInput, sees: boolean): WitchAiOutput {
    const cfg = this.cfg;

    // Игрок вышел за границу её секции: дальше она не идёт — стоит и смотрит.
    if (!inp.playerInTerritory) return this.startWatch(inp, dt);

    if (sees) {
      this.loseTimer = 0;
      this.lastSeen = { x: inp.playerX, z: inp.playerZ };
      this.lostHidden = false;
    } else {
      this.loseTimer += dt;
      if (this.loseTimer >= cfg.loseGrace) {
        this.lostHidden = inp.playerHidden;
        this.startSearch(inp);
        return this.output(0, 0);
      }
    }

    this.chaseBudget -= dt;
    this.chaseClock += dt;
    const dPlayer = Math.hypot(inp.playerX - inp.x, inp.playerZ - inp.z);

    // Устала или слишком далеко от дома — останавливается и смотрит (а не бросает всё мгновенно).
    // Рядом с игроком (в пределах «провокации») не сдаётся — она вот-вот его достанет.
    const tired = this.chaseBudget <= 0 && dPlayer > cfg.provokeDistance;
    const leashed = this.distToHome(inp) > cfg.leash && dPlayer > cfg.provokeDistance + 1;
    if (tired || leashed) return this.startWatch(inp, dt);

    const goal = this.lastSeen ?? { x: inp.playerX, z: inp.playerZ };
    if (this.reached(inp, goal, cfg.chaseStopDistance)) {
      // Дошла до игрока — стоит и смотрит на него, дальше работает триггер боя.
      this.turnToward(Math.atan2(goal.x - inp.x, goal.z - inp.z), dt, 1.5);
      return this.output(0, 0);
    }

    // Остановка посреди погони (оглядывается, «принюхивается»).
    if (this.hesitateTimer > 0) {
      this.hesitateTimer -= dt;
      this.turnToward(Math.atan2(goal.x - inp.x, goal.z - inp.z), dt, 1);
      return this.output(0, 0);
    }
    if (dPlayer > 3 && this.rng() < this.traits.hesitation * dt) {
      this.hesitateTimer = this.range(cfg.hesitateMin, cfg.hesitateMax);
    }

    // Скорость «плавает» вокруг базовой.
    this.wobbleTimer -= dt;
    if (this.wobbleTimer <= 0) {
      this.wobbleTarget = this.range(cfg.wobbleMin, cfg.wobbleMax);
      this.wobbleTimer = this.range(cfg.wobbleEveryMin, cfg.wobbleEveryMax);
    }
    this.wobble += (this.wobbleTarget - this.wobble) * Math.min(1, dt * 2);
    const speed = cfg.chaseSpeed * this.traits.chaseSpeedMul * this.wobble;

    // Виляние траектории: заметное вдали, к игроку сходит на нет — подходит напрямую.
    const weaveFade = Math.max(0, Math.min(1, (dPlayer - 2.5) / 5));
    const offset =
      this.traits.weaveAmp * weaveFade * Math.sin(TWO_PI * this.traits.weaveFreq * this.chaseClock + this.weavePhase);

    return this.walkTo(inp, goal, speed, dt, offset);
  }

  private tickSearch(dt: number, inp: WitchAiInput): WitchAiOutput {
    const cfg = this.cfg;
    const anchor = this.searchAnchor;
    if (!anchor) {
      this.startReturn();
      return this.output(0, 0);
    }

    if (this.searchPhase === "scan") {
      // Оглядывается на месте: взгляд скользит из стороны в сторону вокруг направления на точку пропажи.
      this.timer -= dt;
      this.lookTimer -= dt;
      if (this.lookTimer <= 0) {
        const toAnchor = Math.atan2(anchor.x - inp.x, anchor.z - inp.z);
        this.lookYaw = toAnchor + (this.rng() * 2 - 1) * ((80 * Math.PI) / 180);
        this.lookTimer = this.range(0.3, 0.6);
      }
      this.turnToward(this.lookYaw, dt, 1.4);
      if (this.timer <= 0) {
        this.searchPhase = "approach";
        this.timer = 5;
      }
      return this.output(0, 0);
    }

    if (this.searchPhase === "approach") {
      this.timer -= dt;
      // Подходит к месту пропажи, но не вплотную (куст — не её территория).
      if (this.timer <= 0 || this.reached(inp, anchor, cfg.searchRingMin)) {
        this.enterLinger();
      } else {
        return this.walkTo(inp, anchor, cfg.chaseSpeed * this.traits.chaseSpeedMul * 0.8, dt);
      }
    }

    // linger: пару секунд ходит кругами рядом с местом пропажи, то и дело замирая.
    this.timer -= dt;
    if (this.timer <= 0) {
      this.lastSeen = null;
      this.startReturn();
      return this.output(0, 0);
    }
    if (this.pauseTimer > 0) {
      this.pauseTimer -= dt;
      this.turnToward(this.lookYaw, dt, 1);
      return this.output(0, 0);
    }
    if (!this.target || this.reached(inp, this.target, 0.25)) {
      if (this.target && this.rng() < cfg.lingerPauseChance) {
        // Постоять и оглянуться вместо следующего шага.
        this.target = null;
        this.pauseTimer = this.range(cfg.pauseMin, cfg.pauseMax);
        this.lookYaw = this.yaw + (this.rng() * 2 - 1) * ((110 * Math.PI) / 180);
        return this.output(0, 0);
      }
      // Следующая точка кольца — недалеко по дуге от текущей (≈35–75°): так она обходит
      // место пропажи кругом, а не срезает хордой прямо через куст, где мог спрятаться игрок.
      const here = Math.atan2(inp.x - anchor.x, inp.z - anchor.z);
      const sign = this.rng() < 0.5 ? -1 : 1;
      const a = here + sign * this.range(0.6, 1.3);
      const r = this.range(cfg.searchRingMin, cfg.searchRingMax);
      this.target = { x: anchor.x + Math.sin(a) * r, z: anchor.z + Math.cos(a) * r };
    }
    return this.walkTo(inp, this.target, cfg.wanderSpeed, dt);
  }

  // --------------------------------------------------------------------------
  // Зрение
  // --------------------------------------------------------------------------

  /** Только геометрия зрения (без LOS): полезно для тестов и отладочного конуса. */
  public inCone(inp: Pick<WitchAiInput, "x" | "z" | "playerX" | "playerZ">): boolean {
    const tracking = this.state === "chase" || this.state === "notice" || this.state === "watch";
    const range = this.cfg.viewRange * this.traits.viewRangeMul * (tracking ? this.cfg.trackRangeMul : 1);
    const halfFov = (this.cfg.fov / 2) * this.traits.fovMul * (tracking ? this.cfg.trackFovMul : 1);
    const dx = inp.playerX - inp.x;
    const dz = inp.playerZ - inp.z;
    if (dx * dx + dz * dz > range * range) return false;
    if (dx === 0 && dz === 0) return true;
    return Math.abs(wrapAngle(Math.atan2(dx, dz) - this.yaw)) <= halfFov;
  }

  private canSee(inp: WitchAiInput): boolean {
    if (inp.playerHidden) return false; // в кусте — невидим
    if (!this.inCone(inp)) return false;
    return inp.lineOfSight();
  }

  // --------------------------------------------------------------------------
  // Переходы состояний
  // --------------------------------------------------------------------------

  private rollTraits(): WitchTraits {
    const r = TRAIT_RANGES;
    return {
      viewRangeMul: this.range(r.viewRangeMul[0], r.viewRangeMul[1]),
      fovMul: this.range(r.fovMul[0], r.fovMul[1]),
      chaseSpeedMul: this.range(r.chaseSpeedMul[0], r.chaseSpeedMul[1]),
      reactionMul: this.range(r.reactionMul[0], r.reactionMul[1]),
      patience: this.range(r.patience[0], r.patience[1]),
      weaveAmp: this.range(r.weaveAmp[0], r.weaveAmp[1]),
      weaveFreq: this.range(r.weaveFreq[0], r.weaveFreq[1]),
      hesitation: this.range(r.hesitation[0], r.hesitation[1]),
      predictChance: this.range(r.predictChance[0], r.predictChance[1]),
    };
  }

  private startIdle(): void {
    this.state = "idle";
    this.target = null;
    this.timer = this.range(this.cfg.idleMin, this.cfg.idleMax);
    // Оглядывается: новый курс в пределах ±100° от текущего.
    this.lookYaw = this.yaw + (this.rng() * 2 - 1) * ((100 * Math.PI) / 180);
  }

  /** Заметила игрока: в своей секции — паузу узнавания и погоню; в чужой — только наблюдение. */
  private onSpotted(inp: WitchAiInput, dt: number, reactionMul: number): WitchAiOutput {
    if (!inp.playerInTerritory) return this.startWatch(inp, dt);
    const out = this.startNoticeFrom(inp, reactionMul);
    this.turnToward(Math.atan2(inp.playerX - inp.x, inp.playerZ - inp.z), dt, 1.6);
    return out;
  }

  private startNoticeFrom(inp: WitchAiInput, reactionMul: number): WitchAiOutput {
    this.state = "notice";
    this.target = null;
    this.loseTimer = 0;
    this.lastSeen = { x: inp.playerX, z: inp.playerZ };
    this.lostHidden = false;
    this.timer = this.range(this.cfg.reactionMin, this.cfg.reactionMax) * this.traits.reactionMul * reactionMul;
    return this.output(0, 0);
  }

  private startChase(): void {
    this.state = "chase";
    this.loseTimer = 0;
    this.target = null;
    // Каждая погоня — со своим «запасом сил», ритмом скорости и фазой виляния.
    this.chaseBudget = this.range(this.cfg.chaseBudgetMin, this.cfg.chaseBudgetMax) * this.traits.patience;
    this.wobble = 1;
    this.wobbleTarget = this.range(this.cfg.wobbleMin, this.cfg.wobbleMax);
    this.wobbleTimer = this.range(this.cfg.wobbleEveryMin, this.cfg.wobbleEveryMax);
    this.hesitateTimer = 0;
    this.weavePhase = this.rng() * TWO_PI;
    this.chaseClock = 0;
  }

  private startSearch(inp: WitchAiInput): void {
    const cfg = this.cfg;
    this.state = "search";
    this.target = null;
    this.pauseTimer = 0;
    const seen = this.lastSeen ?? { x: inp.playerX, z: inp.playerZ };

    // Если игрок пропал не в кусте (а за деревом/углом/убежал), ведьма может угадать, куда он
    // бежал, и пойти «вперёд по ходу». В куст, где он сидит, она так не полезет: цель — это
    // место пропажи, вокруг которого она потом ходит кругами.
    const speed = Math.hypot(this.pvx, this.pvz);
    if (!this.lostHidden && speed > MIN_PREDICT_SPEED && this.rng() < this.traits.predictChance) {
      const lead = this.range(cfg.predictLeadMin, cfg.predictLeadMax);
      this.searchAnchor = { x: seen.x + (this.pvx / speed) * lead, z: seen.z + (this.pvz / speed) * lead };
    } else {
      this.searchAnchor = seen;
    }

    if (this.rng() < cfg.scanChance) {
      this.searchPhase = "scan";
      this.timer = this.range(cfg.scanMin, cfg.scanMax);
      this.lookTimer = 0;
    } else {
      this.searchPhase = "approach";
      this.timer = 5; // максимум времени дойти до места пропажи
    }
  }

  private enterLinger(): void {
    this.searchPhase = "linger";
    this.timer = this.range(this.cfg.searchLingerMin, this.cfg.searchLingerMax) * this.traits.patience;
    this.target = null;
    this.pauseTimer = 0;
  }

  /** Стоит и смотрит на игрока, пока он виден (но не вечно). Погоня за границу секции/поводок. */
  private startWatch(inp: WitchAiInput, dt: number): WitchAiOutput {
    this.state = "watch";
    this.target = null;
    this.loseTimer = 0;
    this.lastSeen = this.lastSeen ?? { x: inp.playerX, z: inp.playerZ };
    this.timer = this.range(this.cfg.watchMin, this.cfg.watchMax) * this.traits.patience;
    this.turnToward(Math.atan2(this.lastSeen.x - inp.x, this.lastSeen.z - inp.z), dt, 1.2);
    return this.output(0, 0);
  }

  private startReturn(): void {
    this.state = "return";
    this.target = null;
    this.loseTimer = 0;
    this.searchAnchor = null;
  }

  // --------------------------------------------------------------------------
  // Движение
  // --------------------------------------------------------------------------

  private walkTo(inp: WitchAiInput, goal: Point, speed: number, dt: number, headingOffset = 0): WitchAiOutput {
    const dx = goal.x - inp.x;
    const dz = goal.z - inp.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return this.output(0, 0);
    const heading = Math.atan2(dx, dz) + headingOffset;
    this.turnToward(heading, dt, 1);
    // Не разгоняется, пока не развернулась лицом по ходу: иначе «скользит боком».
    const facing = Math.max(0, Math.cos(wrapAngle(heading - this.yaw)));
    const v = speed * (0.25 + 0.75 * facing);
    return this.output(Math.sin(heading) * v, Math.cos(heading) * v);
  }

  private turnToward(target: number, dt: number, rateMul: number): void {
    const diff = wrapAngle(target - this.yaw);
    const maxStep = this.cfg.turnRate * rateMul * dt;
    this.yaw = wrapAngle(this.yaw + Math.max(-maxStep, Math.min(maxStep, diff)));
  }

  private pickWanderTarget(inp: WitchAiInput): boolean {
    for (let i = 0; i < 4; i++) {
      const a = this.rng() * TWO_PI;
      const r = this.cfg.wanderRadius * Math.sqrt(this.rng());
      const t = { x: this.homeX + Math.sin(a) * r, z: this.homeZ + Math.cos(a) * r };
      if (Math.hypot(t.x - inp.x, t.z - inp.z) >= 0.8) {
        this.target = t;
        return true;
      }
    }
    return false;
  }

  /** Сглаженная скорость игрока: нужна, чтобы «угадать», куда он убегал. */
  private trackPlayer(dt: number, inp: WitchAiInput): void {
    if (this.prevPX !== null) {
      const k = Math.min(1, dt * 6);
      this.pvx += ((inp.playerX - this.prevPX) / dt - this.pvx) * k;
      this.pvz += ((inp.playerZ - this.prevPZ) / dt - this.pvz) * k;
    }
    this.prevPX = inp.playerX;
    this.prevPZ = inp.playerZ;
  }

  private updateStuck(dt: number, x: number, z: number): void {
    if (this.prevX !== null && this.prevSpeed > 0.05) {
      const moved = Math.hypot(x - this.prevX, z - this.prevZ);
      const expected = this.prevSpeed * dt;
      this.stuckTimer = moved < expected * 0.2 ? this.stuckTimer + dt : 0;
    } else {
      this.stuckTimer = 0;
    }
    this.prevX = x;
    this.prevZ = z;

    if (this.stuckTimer < this.cfg.stuckTime) return;
    this.stuckTimer = 0;
    // Упёрлась — не бьёмся в стену вечно, переходим к следующему этапу.
    switch (this.state) {
      case "wander":
      case "return":
        this.startIdle();
        break;
      case "chase":
        // Не может дойти (ворота, угол стены), а игрок виден — без паузы она бы тут же
        // заметила его снова и вечно упиралась в препятствие. Сдаётся на несколько секунд.
        this.ignoreTimer = Math.max(this.ignoreTimer, STUCK_GIVE_UP_SECONDS);
        if (this.lastInp) this.startSearch(this.lastInp);
        else this.startReturn();
        break;
      case "search":
        if (this.searchPhase === "approach") this.enterLinger();
        else this.target = null;
        break;
      default:
        break;
    }
  }

  private output(vx: number, vz: number): WitchAiOutput {
    this.prevSpeed = Math.hypot(vx, vz);
    return { vx, vz, yaw: this.yaw, state: this.state };
  }

  private reached(inp: WitchAiInput, p: Point, radius: number): boolean {
    return Math.hypot(p.x - inp.x, p.z - inp.z) <= radius;
  }

  private distToHome(inp: WitchAiInput): number {
    return Math.hypot(this.homeX - inp.x, this.homeZ - inp.z);
  }

  private range(min: number, max: number): number {
    return min + this.rng() * (max - min);
  }
}
