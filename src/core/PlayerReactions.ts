import type { PlayerMotion } from "./PlayerAnimator";
import {
  ALERT_GESTURES,
  ARRIVAL_GESTURES,
  BONK_GESTURES,
  BURN_GESTURES,
  CHEST_GESTURES,
  FIDGET_GESTURES,
  GATE_OPENED_GESTURES,
  GATE_PUSH_GESTURES,
  HIDDEN_ALERT_GESTURES,
  HIDE_GESTURES,
  IDLE_ACTION_GESTURES,
  LEARNED_GESTURES,
  REFRESHED_GESTURES,
  RELIEF_GESTURES,
  SIT_POSES,
  SNEAK_POSES,
  STANCE_POSES,
  STUCK_GESTURES,
  TIRED_GESTURES,
  TREASURE_GESTURES,
  WEARY_POSES,
} from "./playerGestures";
import type { GestureId, HeldId } from "./playerGestures";
import type { ProgressDelta } from "./progressWatcher";

/** Что реакциям нужно от аниматора (PlayerAnimator подходит как есть; в тестах — запись вызовов). */
export interface ReactionAnimator {
  play(id: GestureId, force?: boolean): boolean;
  playOneOf(ids: readonly GestureId[], poolKey?: string): GestureId | null;
  setHeld(id: HeldId | null): void;
  look(yaw: number, pitch?: number, strength?: number): void;
  clearLook(): void;
  readonly isBusy: boolean;
}

interface Point {
  readonly x: number;
  readonly z: number;
}

/** Что реакциям нужно от игрока. */
export interface ReactionPlayer {
  readonly animator: ReactionAnimator;
  readonly motion: PlayerMotion;
  readonly position: Point;
  /** Курс, в который смотрит модель игрока (рад, 0 = +Z). */
  readonly facingYaw: number;
  faceToward(x: number, z: number): void;
}

export type AlertLevel = "none" | "notice" | "search" | "chase";

/** Что реакциям нужно от мира. Всё, кроме костров, необязательно: нет данных — нет и реакции. */
export interface ReactionWorld {
  /** Где горят костры (на них можно «наступить»). */
  activeBonfires(): Iterable<{ readonly position: Point }>;
  /** Живые ведьмы и их тревога по отношению к игроку (на заметившую герой оглядывается и пугается). */
  activeWitches?(): Iterable<{ readonly position: Point; readonly alertLevel: AlertLevel }>;
  /** Сундуки: на нетронутый герой косится на ходу. */
  activeChests?(): Iterable<{ readonly position: Point; readonly isOpened: boolean }>;
}

/** Состояние игры на этот кадр. */
export interface ReactionState {
  /** Открыто любое меню или бой: игрок заблокирован. */
  menuOpen: boolean;
  inCombat: boolean;
  /** Открыто меню костра: игрок сидит у огня. */
  atBonfire: boolean;
  /** Игрок прячется в кусте. */
  hidden: boolean;
  /** Сколько у игрока Силы, доля 0…1 (мало — устал). */
  powerFraction: number;
  /** В какой секции мира сейчас игрок (новая, дальше всех — «ого, новое место»). */
  section: number;
}

/** Какие удерживаемые позы бывают у каждого состояния: вариант выбирается заново при каждом входе в состояние. */
const HELD_VARIANTS = { stance: STANCE_POSES, sit: SIT_POSES, sneak: SNEAK_POSES, weary: WEARY_POSES } as const;
type HeldKind = keyof typeof HELD_VARIANTS;

/** Доля желаемого шага, ниже которой считаем, что игрок упёрся (скольжение вдоль стены — выше). */
const BLOCKED_PROGRESS = 0.2;
/** Через сколько секунд упора на бегу срабатывает «ткнулся». */
const BONK_AFTER = 0.06;
/** Минимальная скорость до удара, чтобы это был «ткнулся», а не «подошёл вплотную», м/с. */
const BONK_MIN_SPEED = 3.5;
const BONK_COOLDOWN = 3;
/** Сколько упираться в стену, чтобы персонаж почесал голову или пожал плечами, с. */
const STUCK_AFTER = 1.2;
const STUCK_COOLDOWN = 10;
/** Радиус костра, на который можно «наступить» (брёвна — 1.4 м крест-накрест), м. */
const BURN_RADIUS = 0.7;
/** Пауза между подскоками, если стоять в огне, с. */
const BURN_COOLDOWN = 1.6;
/** Как часто стоящий без дела игрок сам себя чем-то занимает, с (уставший — втрое чаще: ему тяжело). */
const FIDGET_MIN = 9;
const FIDGET_MAX = 18;
const WEARY_FIDGET_SCALE = 0.35;
/** Выше этой скорости (м/с) нажатие «действия» без цели жеста не вызывает: на бегу не до того. */
const IDLE_ACTION_MAX_SPEED = 1;

/** Как часто (с) осматривается мир: ведьмы, сундуки. Покадрово не нужно — цель успевает сдвинуться лишь чуть-чуть. */
const SCAN_INTERVAL = 0.25;
/** Дальше этого (м) ведьма героя не пугает. */
const WITCH_NOTICE_RANGE = 30;
/** На нетронутый сундук герой косится с такого расстояния (м). */
const CHEST_LOOK_RANGE = 8;
/** Как сильно поворачивает голову к ведьме и к сундуку. */
const WITCH_LOOK_STRENGTH = 0.95;
const CHEST_LOOK_STRENGTH = 0.7;
/** Цель почти за спиной (больше этого угла, рад) — не оборачиваемся. */
const LOOK_MAX_ANGLE = 2.2;
const ALERT_COOLDOWN = 6;
const LOST_CHASE_COOLDOWN = 8;
/** Ранг тревоги: чем выше, тем опаснее. */
const ALERT_RANK: Readonly<Record<AlertLevel, number>> = { none: 0, notice: 1, search: 2, chase: 3 };
/** Устал при Силе ниже этой доли и отдохнул при выше второй (гистерезис, чтобы не дёргалось на границе). */
const WEARY_BELOW = 0.25;
const RESTED_ABOVE = 0.4;
/** Находка из сундука показывается не сразу: сначала герой открывает крышку, с. */
const TREASURE_DELAY = 1.5;

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Живая реакция персонажа на мир. Ничего не меняет в игровой логике — только запускает жесты и позы
 * у аниматора и поворачивает голову. На каждое действие — несколько вариантов (наборы в playerGestures.ts),
 * выбор случайный и без повтора подряд:
 *  - упёрся в стену на бегу — «бонк» (откинуло / закружилась голова / схватился за нос), стоит и давит —
 *    чешет голову, пожимает плечами, фейспалм, постукивает ногой, смотрит в небо;
 *  - наступил на костёр — подпрыгивает, будто обжёгся (три варианта);
 *  - нажал «действие», когда рядом никого нет — чешет голову, садится посидеть, оглядывается, зевает, пританцовывает…;
 *  - долго стоит без дела — иногда сам себя чем-то занимает (устал — тяжело дышит);
 *  - ведьма его заметила — вздрагивает, сглатывает или резко оглядывается (в кустах — замирает);
 *    погоня кончилась — выдыхает;
 *  - нырнул в куст — пригибается тремя разными способами;
 *  - вошёл в новую секцию — козыряет ладонью над глазами, показывает вдаль, вдыхает новый воздух;
 *  - изучил заклинание, разрушил барьер, нашёл книгу или страницу — радуется (три варианта на каждое);
 *  - голова сама поворачивается к заметившей ведьме и к нетронутому сундуку;
 *  - в бою — одна из боевых стоек, у костра (открыто меню) — сидит по-разному, в кустах — по-разному
 *    крадётся, при малой Силе — ссутулился.
 * Вызывается раз в кадр после PlayerController.update и стелса; события мира (костёр, сундук, ворота,
 * прогресс) приходят из interaction.ts и Game.
 */
export class PlayerReactions {
  private frozen = false;
  private blockedFor = 0;
  private bonked = false;
  private stuckPlayed = false;
  private bonkCooldown = 0;
  private stuckCooldown = 0;
  /** Скорость до упора (затухающий максимум): отличает «ткнулся на бегу» от «подошёл к стене». */
  private runSpeed = 0;
  private burnCooldown = 0;
  private idleFor = 0;
  private nextFidgetAt: number;
  private heldKind: HeldKind | null = null;
  private heldPick: HeldId | null = null;
  private readonly lastHeld = new Map<HeldKind, HeldId>();

  private weary = false;
  private restedPending = false;
  private wasHidden = false;
  private maxSection: number | null = null;
  private scanTimer = 0;
  private alertRank = 0;
  private alertCooldown = 0;
  private lostChaseCooldown = 0;
  /** На что сейчас смотрит герой (живая точка мира) и насколько сильно. */
  private aim: Point | null = null;
  private aimStrength = 0;
  private scheduled: Array<{ at: number; run: () => void }> = [];

  constructor(
    private readonly player: ReactionPlayer,
    private readonly world: ReactionWorld,
    private readonly random: () => number = Math.random
  ) {
    this.nextFidgetAt = this.rollFidget();
  }

  /** Кадр реакций. */
  public update(dt: number, state: ReactionState): void {
    const animator = this.player.animator;
    this.updateWeary(state);
    animator.setHeld(this.heldFor(state));

    this.bonkCooldown = Math.max(0, this.bonkCooldown - dt);
    this.stuckCooldown = Math.max(0, this.stuckCooldown - dt);
    this.burnCooldown = Math.max(0, this.burnCooldown - dt);
    this.alertCooldown = Math.max(0, this.alertCooldown - dt);
    this.lostChaseCooldown = Math.max(0, this.lostChaseCooldown - dt);
    this.runScheduled(dt);

    this.frozen = state.menuOpen || state.inCombat;
    if (this.maxSection === null) this.maxSection = state.section;
    if (this.frozen) {
      this.blockedFor = 0;
      this.bonked = false;
      this.stuckPlayed = false;
      this.idleFor = 0;
      this.alertRank = 0; // конец боя не должен выглядеть как «ушёл от погони»
      this.aim = null;
      this.wasHidden = state.hidden;
      this.maxSection = Math.max(this.maxSection, state.section);
      this.restedPending = false;
      animator.clearLook();
      return;
    }

    const motion = this.player.motion;
    this.trackWall(dt, motion);
    this.trackFire();
    this.trackHide(state);
    this.trackSection(state);
    this.trackRested(motion);
    this.trackIdle(dt, motion, state);
    this.scanWorld(dt, state);
    this.applyLook();
  }

  /** Нажали «действие», а рядом никого и ничего нет: чем-нибудь себя занять. Возвращает сыгранный жест. */
  public onIdleInteract(): GestureId | null {
    if (this.frozen || this.player.motion.speed > IDLE_ACTION_MAX_SPEED) return null;
    const id = this.player.animator.playOneOf(IDLE_ACTION_GESTURES, "idleAction");
    if (id) this.idleFor = 0;
    return id;
  }

  /** Села у костра (открылось меню костра): лицом к огню. Саму позу «сидит» держит update, пока меню открыто. */
  public onBonfireOpened(x: number, z: number): void {
    this.player.faceToward(x, z);
  }

  /** Открыли сундук: повернулся к нему и склонился над крышкой. */
  public onChestOpened(x: number, z: number): void {
    this.player.faceToward(x, z);
    this.player.animator.playOneOf(CHEST_GESTURES, "chest");
  }

  /** Подошёл к барьеру и пробует его на прочность. */
  public onGateOpened(x: number, z: number): void {
    this.player.faceToward(x, z);
    this.player.animator.playOneOf(GATE_PUSH_GESTURES, "gatePush");
  }

  /** У игрока что-то прибавилось (см. ProgressWatcher): порадоваться. */
  public onProgress(delta: ProgressDelta): void {
    const animator = this.player.animator;
    if (delta.spellLearned) animator.playOneOf(LEARNED_GESTURES, "learned");
    else if (delta.gateOpened) animator.playOneOf(GATE_OPENED_GESTURES, "gateOpened");
    // Находка лежит в только что открытом сундуке: даём сначала доиграть «открыл крышку».
    if (delta.treasure) this.schedule(TREASURE_DELAY, () => void animator.playOneOf(TREASURE_GESTURES, "treasure"));
  }

  // ---------- Наблюдатели ----------

  private trackWall(dt: number, m: PlayerMotion): void {
    const decay = Math.exp(-dt * 4);
    const blocked = m.intent && m.progress < BLOCKED_PROGRESS;
    if (!blocked) {
      this.runSpeed = Math.max(m.speed, this.runSpeed * decay);
      this.blockedFor = 0;
      this.bonked = false;
      this.stuckPlayed = false;
      return;
    }
    this.runSpeed *= decay;
    this.blockedFor += dt;
    const animator = this.player.animator;

    if (!this.bonked && this.blockedFor >= BONK_AFTER) {
      this.bonked = true;
      if (this.bonkCooldown === 0 && this.runSpeed >= BONK_MIN_SPEED && animator.playOneOf(BONK_GESTURES, "bonk")) this.bonkCooldown = BONK_COOLDOWN;
    }
    if (!this.stuckPlayed && this.blockedFor >= STUCK_AFTER) {
      this.stuckPlayed = true;
      if (this.stuckCooldown === 0 && animator.playOneOf(STUCK_GESTURES, "stuck")) this.stuckCooldown = STUCK_COOLDOWN;
    }
  }

  private trackFire(): void {
    if (this.burnCooldown > 0) return;
    const p = this.player.position;
    for (const bonfire of this.world.activeBonfires()) {
      const dx = bonfire.position.x - p.x;
      const dz = bonfire.position.z - p.z;
      if (dx * dx + dz * dz > BURN_RADIUS * BURN_RADIUS) continue;
      if (this.player.animator.playOneOf(BURN_GESTURES, "burn")) this.burnCooldown = BURN_COOLDOWN;
      return;
    }
  }

  /** Нырнул в куст: пригнулся (дальше позу крадущегося держит update). */
  private trackHide(state: ReactionState): void {
    if (state.hidden && !this.wasHidden) this.player.animator.playOneOf(HIDE_GESTURES, "hide");
    this.wasHidden = state.hidden;
  }

  /** Вошёл в секцию, где ещё не был дальше всех: оглядывает новое место (жест верха тела — играет и на ходу). */
  private trackSection(state: ReactionState): void {
    if (this.maxSection === null || state.section <= this.maxSection) return;
    this.maxSection = state.section;
    if (!state.hidden) this.player.animator.playOneOf(ARRIVAL_GESTURES, "arrival");
  }

  /** Сила восстановилась после усталости: потянулся (если стоит; на бегу не до того). */
  private trackRested(m: PlayerMotion): void {
    if (!this.restedPending) return;
    this.restedPending = false;
    if (m.intent || m.speed >= 0.1) return;
    this.player.animator.playOneOf(REFRESHED_GESTURES, "refreshed");
  }

  private trackIdle(dt: number, m: PlayerMotion, state: ReactionState): void {
    const standing = !m.intent && m.speed < 0.1;
    if (!standing || state.hidden || state.atBonfire || this.player.animator.isBusy) {
      this.idleFor = 0;
      return;
    }
    this.idleFor += dt;
    if (this.idleFor < this.nextFidgetAt) return;
    this.idleFor = 0;
    this.nextFidgetAt = this.rollFidget();
    // Уставший вместо зевков и разминок тяжело дышит и вытирает пот.
    this.player.animator.playOneOf(this.weary ? TIRED_GESTURES : FIDGET_GESTURES, this.weary ? "tired" : "fidget");
  }

  /** Раз в четверть секунды осматривается: заметила ли ведьма, есть ли рядом нетронутый сундук. */
  private scanWorld(dt: number, state: ReactionState): void {
    this.scanTimer += dt;
    if (this.scanTimer < SCAN_INTERVAL) return;
    this.scanTimer = 0;

    const p = this.player.position;
    let rank = 0;
    let witchAim: Point | null = null;
    let witchDist = Infinity;
    const witches = this.world.activeWitches?.();
    if (witches) {
      for (const witch of witches) {
        const r = ALERT_RANK[witch.alertLevel];
        if (r === 0) continue;
        const dx = witch.position.x - p.x;
        const dz = witch.position.z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > WITCH_NOTICE_RANGE * WITCH_NOTICE_RANGE) continue;
        rank = Math.max(rank, r);
        if (d2 < witchDist) {
          witchDist = d2;
          witchAim = witch.position;
        }
      }
    }

    let chestAim: Point | null = null;
    if (!witchAim && !state.hidden) {
      const chests = this.world.activeChests?.();
      if (chests) {
        let best = CHEST_LOOK_RANGE * CHEST_LOOK_RANGE;
        for (const chest of chests) {
          if (chest.isOpened) continue;
          const dx = chest.position.x - p.x;
          const dz = chest.position.z - p.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < best) {
            best = d2;
            chestAim = chest.position;
          }
        }
      }
    }

    if (witchAim) {
      this.aim = witchAim;
      this.aimStrength = WITCH_LOOK_STRENGTH;
    } else if (chestAim) {
      this.aim = chestAim;
      this.aimStrength = CHEST_LOOK_STRENGTH;
    } else {
      this.aim = null;
    }

    const animator = this.player.animator;
    if (rank > this.alertRank && rank >= 1) {
      // Заметили: на виду — вздрагивает, в кустах — замирает.
      if (this.alertCooldown === 0 && animator.playOneOf(state.hidden ? HIDDEN_ALERT_GESTURES : ALERT_GESTURES, state.hidden ? "hiddenAlert" : "alert")) {
        this.alertCooldown = ALERT_COOLDOWN;
      }
    } else if (this.alertRank === ALERT_RANK.chase && rank < ALERT_RANK.chase) {
      // Погоня кончилась: выдохнул.
      if (this.lostChaseCooldown === 0 && animator.playOneOf(RELIEF_GESTURES, "lostChase")) this.lostChaseCooldown = LOST_CHASE_COOLDOWN;
    }
    this.alertRank = rank;
  }

  /** Каждый кадр доворачивает голову к цели: по текущему положению героя и его курсу, а не по давнему осмотру. */
  private applyLook(): void {
    const animator = this.player.animator;
    const aim = this.aim;
    if (!aim) {
      animator.clearLook();
      return;
    }
    const p = this.player.position;
    const dx = aim.x - p.x;
    const dz = aim.z - p.z;
    if (dx * dx + dz * dz < 0.25) {
      animator.clearLook();
      return;
    }
    const rel = wrapAngle(Math.atan2(dx, dz) - this.player.facingYaw);
    if (Math.abs(rel) > LOOK_MAX_ANGLE) animator.clearLook();
    else animator.look(rel, 0, this.aimStrength);
  }

  // ---------- Состояния ----------

  /** Устал при малой Силе, отдохнул при восстановлении (с гистерезисом); отдохнул — запоминаем, чтобы потянуться. */
  private updateWeary(state: ReactionState): void {
    if (!this.weary && state.powerFraction < WEARY_BELOW) {
      this.weary = true;
      this.nextFidgetAt = Math.min(this.nextFidgetAt, this.rollFidget());
    } else if (this.weary && state.powerFraction >= RESTED_ABOVE) {
      this.weary = false;
      this.restedPending = true;
    }
  }

  /** Удерживаемая поза для состояния игры; вариант выбирается один раз при входе в состояние. */
  private heldFor(state: ReactionState): HeldId | null {
    const kind: HeldKind | null = state.inCombat ? "stance" : state.atBonfire ? "sit" : state.hidden ? "sneak" : this.weary ? "weary" : null;
    if (kind !== this.heldKind) {
      this.heldKind = kind;
      this.heldPick = kind ? this.pickHeld(kind) : null;
    }
    return this.heldPick;
  }

  private pickHeld(kind: HeldKind): HeldId {
    const pool = HELD_VARIANTS[kind];
    const last = this.lastHeld.get(kind);
    const candidates = pool.length > 1 ? pool.filter((id) => id !== last) : pool;
    const id = candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))];
    this.lastHeld.set(kind, id);
    return id;
  }

  private rollFidget(): number {
    const base = FIDGET_MIN + this.random() * (FIDGET_MAX - FIDGET_MIN);
    return this.weary ? base * WEARY_FIDGET_SCALE : base;
  }

  private schedule(delay: number, run: () => void): void {
    this.scheduled.push({ at: delay, run });
  }

  private runScheduled(dt: number): void {
    if (this.scheduled.length === 0) return;
    const due: Array<() => void> = [];
    this.scheduled = this.scheduled.filter((s) => {
      s.at -= dt;
      if (s.at > 0) return true;
      due.push(s.run);
      return false;
    });
    for (const run of due) run();
  }
}
