import { clamp01 } from "./easing";
import { CHANNELS, emptyPose, sampleTrack } from "./playerPose";
import type { Channel, GestureDef, Key, PoseValues } from "./playerPose";
import { GESTURES, HELD_POSES } from "./playerGestures";
import type { GestureId, HeldId } from "./playerGestures";
import { HIP_Y } from "./playerRig";
import type { PlayerRig } from "./playerRig";

/** Что аниматору нужно знать о движении за кадр (его считает PlayerController). */
export interface PlayerMotion {
  /** Фактическая горизонтальная скорость, м/с (у стены — около нуля, даже если клавиша зажата). */
  speed: number;
  /** Игрок хочет идти (клавиша/стик нажаты и ввод не заблокирован). */
  intent: boolean;
  /** Доля желаемого шага, которая реально прошла по направлению хода: 1 — свободно, ~0 — упёрся в стену. */
  progress: number;
}

/** Скорость, при которой походка максимальна (м/с). */
const WALK_SPEED_REF = 6.5;
/** Фаза шага на метр пути (рад): 2π — два шага. */
const PHASE_PER_METER = 1.9;
const LEG_SWING = 0.55;
const ARM_SWING = 0.6;
/** С какой доли пройденного шага игрок считается «идущим» и обрывает необязательные жесты. */
const WALK_CANCEL_PROGRESS = 0.3;
/** Предел поворота головы к цели относительно курса тела, рад (≈ 57°); плечи доворачиваются на долю этого угла. */
const LOOK_MAX_YAW = 1.0;
const LOOK_MAX_PITCH = 0.5;
const LOOK_TORSO_SHARE = 0.25;
/** Не «перематываем» анимацию после лага или паузы вкладки. */
const MAX_STEP = 0.1;
/** Затухание жеста, который вытеснил другой жест (новый плавно входит поверх), с. */
const REPLACE_FADE = 0.15;
/** Затухание жеста, который оборвал шаг или stopGesture(): рука опускается, а не «телепортируется», с. */
const CANCEL_FADE = 0.25;
/** Вход и выход жеста по умолчанию, с (подробности — у GestureDef). */
const DEFAULT_FADE_IN = 0.05;
const DEFAULT_FADE_OUT = 0.06;

/** Размеры бокса ноги (для контакта с полом: нога — бокс 0.3 × 0.8 × 0.35, шарнир на её верхушке). */
const LEG_LENGTH = 0.8;
const LEG_HALF_DEPTH = 0.175;

const smooth = (w: number): number => w * w * (3 - 2 * w);

/** Самая низкая точка ноги относительно бедра (м, отрицательная), когда она повёрнута на pitch. */
function legLowestY(pitch: number): number {
  const c = Math.cos(pitch);
  const s = Math.sin(pitch);
  let lowest = Infinity;
  for (const y of [-LEG_LENGTH, 0]) {
    for (const z of [-LEG_HALF_DEPTH, LEG_HALF_DEPTH]) lowest = Math.min(lowest, y * c - z * s);
  }
  return lowest;
}

/**
 * Сдвиг тела по высоте, при котором самая низкая точка ног стоит на полу: при шаге нога качается,
 * и без поправки угол бокса то проваливался бы в пол, то персонаж парил бы. Позы пишутся «от ступней»:
 * захотели сесть — повернули ноги вперёд, а тело опустится само.
 */
export function groundOffset(legLPitch: number, legRPitch: number): number {
  const lowest = Math.min(legLowestY(legLPitch), legLowestY(legRPitch));
  return -lowest - HIP_Y;
}

interface Playing {
  readonly id: GestureId;
  readonly def: GestureDef;
  readonly entries: ReadonlyArray<readonly [Channel, readonly Key[]]>;
  t: number;
  /** Текущий вес жеста в позе, 0..1 (до сглаживания). */
  w: number;
  fadeOut: number;
  /** Жест уходит (оборван шагом или вытеснен): вес только падает. */
  leaving: boolean;
}

const ENTRIES = new Map<GestureId, ReadonlyArray<readonly [Channel, readonly Key[]]>>();
function entriesOf(id: GestureId): ReadonlyArray<readonly [Channel, readonly Key[]]> {
  let e = ENTRIES.get(id);
  if (!e) {
    e = Object.entries(GESTURES[id].tracks) as Array<[Channel, readonly Key[]]>;
    ENTRIES.set(id, e);
  }
  return e;
}

/**
 * Оживляет блочного персонажа. Три слоя поверх друг друга:
 *  1. база — дыхание в покое и походка (качание рук и ног, наклон, покачивание тела) по фактической скорости;
 *  2. удерживаемая поза (сидит у костра, боевая стойка) — держится, пока её не снимут, меняется плавно;
 *  3. жест — короткая анимация (почесал голову, прыжок на костре, взмах рукой): входит и выходит плавно.
 * Жест и поза перекрывают только свои каналы: остальное продолжает вести база. Тело само «встаёт» на пол
 * по положению ног (groundOffset). Анимации ведутся от dt — на паузе игры (цикл не вызывается) всё стоит.
 * Сверху — «взгляд»: look() плавно поворачивает голову (и чуть плечи) к цели, пока жест не занял голову.
 */
export class PlayerAnimator {
  private readonly base: PoseValues = emptyPose();
  private readonly final: PoseValues = emptyPose();
  private readonly heldWeights = new Map<HeldId, number>();
  private held: HeldId | null = null;
  private cur: Playing | null = null;
  private out: Playing | null = null;
  private readonly lastPick = new Map<string, GestureId>();
  private time = 0;
  private phase = 0;
  private walk = 0;
  /** Куда смотреть (относительно курса тела) и насколько; strength 0 — никуда. Меняется на месте, без выделения памяти. */
  private readonly lookGoal = { yaw: 0, pitch: 0, strength: 0 };
  private lookYaw = 0;
  private lookPitch = 0;
  private lookW = 0;

  constructor(
    private readonly rig: PlayerRig,
    private readonly random: () => number = Math.random
  ) {
    this.apply();
  }

  /** Поза, выставленная на персонажа в последнем кадре (для тестов и отладки). */
  public get pose(): Readonly<PoseValues> {
    return this.final;
  }

  /** Насколько персонаж сейчас «идёт» (0 — стоит, 1 — полный ход). */
  public get walkAmount(): number {
    return this.walk;
  }

  /** Жест, который сейчас играет (уходящий — нет). */
  public get currentGesture(): GestureId | null {
    return this.cur && !this.cur.leaving ? this.cur.id : null;
  }

  public get heldPose(): HeldId | null {
    return this.held;
  }

  /** Насколько взгляд сейчас включён (0 — смотрит прямо, 1 — полностью повернут к цели). */
  public get lookWeight(): number {
    return this.lookW;
  }

  /**
   * Смотреть в сторону: yaw — угол к цели относительно курса тела (рад, + вправо), pitch — вверх/вниз,
   * strength 0…1 — насколько сильно (0.7 — «скосил глаза», 1 — «повернулся всем лицом»). Вызывать каждый
   * кадр, пока цель интересна; когда перестанет — clearLook(). Голова ведёт себя плавно и не рывками.
   * Пока играет жест, у которого есть свои повороты головы, взгляд уступает ему.
   */
  public look(yaw: number, pitch = 0, strength = 1): void {
    const g = this.lookGoal;
    g.yaw = Math.max(-LOOK_MAX_YAW, Math.min(LOOK_MAX_YAW, yaw));
    g.pitch = Math.max(-LOOK_MAX_PITCH, Math.min(LOOK_MAX_PITCH, pitch));
    g.strength = clamp01(strength);
  }

  /** Отпустить взгляд: голова плавно возвращается прямо. */
  public clearLook(): void {
    this.lookGoal.strength = 0;
  }

  /** Играет ли какой-нибудь жест (в том числе затухающий). */
  public get isBusy(): boolean {
    return this.cur !== null || this.out !== null;
  }

  /** Через сколько секунд после старта жеста «выпускается» заклинание (0 — у жеста нет момента выпуска). */
  public releaseAt(id: GestureId): number {
    return GESTURES[id].releaseAt ?? 0;
  }

  /** Запускает жест. false — не запущен: уже играет более важный (force — вытеснить в любом случае). */
  public play(id: GestureId, force = false): boolean {
    const def = GESTURES[id];
    const cur = this.cur;
    if (!force && cur && !cur.leaving && cur.t < cur.def.duration && def.priority < cur.def.priority) return false;
    if (cur) {
      cur.leaving = true;
      cur.fadeOut = REPLACE_FADE;
      this.out = cur;
    }
    this.cur = { id, def, entries: entriesOf(id), t: 0, w: 0, fadeOut: def.fadeOut ?? DEFAULT_FADE_OUT, leaving: false };
    return true;
  }

  /**
   * Запускает случайный жест из набора, не повторяя прошлый выбор из этого же набора подряд
   * (иначе «три победных танца» могли бы выпасть одним и тем же трижды). Возвращает выбранный или null.
   */
  public playOneOf(ids: readonly GestureId[], poolKey: string = ids.join("|"), force = false): GestureId | null {
    if (ids.length === 0) return null;
    const last = this.lastPick.get(poolKey);
    const candidates = ids.length > 1 ? ids.filter((i) => i !== last) : ids;
    const id = candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))];
    if (!this.play(id, force)) return null;
    this.lastPick.set(poolKey, id);
    return id;
  }

  /** Прервать текущий жест (плавно). */
  public stopGesture(): void {
    if (this.cur) {
      this.cur.leaving = true;
      this.cur.fadeOut = CANCEL_FADE;
    }
  }

  /** Включить удерживаемую позу (или снять — null). Переход плавный. */
  public setHeld(id: HeldId | null): void {
    this.held = id;
    if (id !== null && !this.heldWeights.has(id)) this.heldWeights.set(id, 0);
  }

  /** Мгновенно вернуть нейтральную позу: без жестов и удерживаемых поз (после телепорта, загрузки). */
  public reset(): void {
    this.cur = null;
    this.out = null;
    this.held = null;
    this.heldWeights.clear();
    this.walk = 0;
    this.time = 0;
    this.phase = 0;
    this.lookGoal.strength = 0;
    this.lookW = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.locomote(0, { speed: 0, intent: false, progress: 1 });
    this.compose();
    this.apply();
  }

  /** Кадр анимации. */
  public update(dtRaw: number, motion: PlayerMotion): void {
    const dt = Math.min(dtRaw, MAX_STEP);
    if (dt > 0) {
      this.time += dt;
      this.locomote(dt, motion);
      this.stepHeld(dt);
      this.stepGesture(dt, motion);
      this.stepLook(dt);
    }
    this.compose();
    this.apply();
  }

  // ---------- Слои ----------

  /** База: дыхание и походка по фактической скорости. */
  private locomote(dt: number, m: PlayerMotion): void {
    const target = clamp01(m.speed / WALK_SPEED_REF);
    this.walk += (target - this.walk) * Math.min(1, dt * 12);
    if (target === 0 && this.walk < 0.002) this.walk = 0;
    this.phase += m.speed * dt * PHASE_PER_METER;

    const w = this.walk;
    const idle = 1 - w;
    const sw = Math.sin(this.phase);
    const breath = Math.sin(this.time * 1.8);
    const b = this.base;

    // Левая нога вперёд (sw > 0) — левая рука назад, а плечи чуть довёрнуты в противоход.
    b.legLPitch = -sw * LEG_SWING * w;
    b.legRPitch = sw * LEG_SWING * w;
    b.armLPitch = sw * ARM_SWING * w + 0.03 * breath * idle;
    b.armRPitch = -sw * ARM_SWING * w - 0.03 * breath * idle;
    // В покое руки чуть отведены от тела и «дышат».
    b.armLRoll = -(0.05 + 0.02 * breath) * idle;
    b.armRRoll = (0.05 + 0.02 * breath) * idle;
    b.torsoPitch = 0.012 * breath * idle + 0.1 * w;
    b.torsoYaw = -sw * 0.1 * w;
    b.torsoRoll = Math.cos(this.phase) * 0.03 * w;
    b.headPitch = -0.012 * breath * idle - 0.07 * w;
    b.headYaw = sw * 0.06 * w;
    b.headRoll = 0;
    b.bodyYaw = 0;
    b.bodyY = 0;
  }

  private stepHeld(dt: number): void {
    for (const [id, w] of this.heldWeights) {
      const fade = HELD_POSES[id].fade;
      const next = id === this.held ? Math.min(1, w + dt / fade) : Math.max(0, w - dt / fade);
      if (next === 0 && id !== this.held) this.heldWeights.delete(id);
      else this.heldWeights.set(id, next);
    }
  }

  private stepLook(dt: number): void {
    const g = this.lookGoal;
    this.lookW += (g.strength - this.lookW) * Math.min(1, dt * 4);
    if (g.strength > 0) {
      const k = Math.min(1, dt * 7);
      this.lookYaw += (g.yaw - this.lookYaw) * k;
      this.lookPitch += (g.pitch - this.lookPitch) * k;
    } else if (this.lookW < 0.002) {
      this.lookW = 0;
      this.lookYaw = 0;
      this.lookPitch = 0;
    }
  }

  private stepGesture(dt: number, m: PlayerMotion): void {
    if (this.out) {
      advance(this.out, dt);
      if (this.out.w <= 0 || this.out.t >= this.out.def.duration) this.out = null;
    }
    const cur = this.cur;
    if (cur) {
      // Реальный шаг обрывает «необязательные» жесты: почесался — и пошёл дальше. Клавиша, зажатая
      // в стену (намерение есть, а хода нет), не в счёт: упёршийся в стену всё равно дочешет голову.
      const cancel = cur.def.cancelOnMove;
      if (!cur.leaving && cancel !== undefined && m.intent && m.progress > WALK_CANCEL_PROGRESS && cur.t >= cancel) {
        cur.leaving = true;
        cur.fadeOut = CANCEL_FADE;
      }
      advance(cur, dt);
      if (cur.t >= cur.def.duration || (cur.leaving && cur.w <= 0)) this.cur = null;
    }
  }

  /** Склеивает слои: база → удерживаемые позы → уходящий жест → текущий жест → посадка на пол. */
  private compose(): void {
    const f = this.final;
    for (const c of CHANNELS) f[c] = this.base[c];

    for (const [id, w] of this.heldWeights) {
      const e = smooth(w);
      const values = HELD_POSES[id].values;
      for (const c of CHANNELS) {
        const v = values[c];
        if (v !== undefined) f[c] += (v - f[c]) * e;
      }
    }

    if (this.out) blend(f, this.out);
    if (this.cur) blend(f, this.cur);

    if (this.lookW > 0) {
      // Жест, который сам ведёт голову (почесался, огляделся), важнее взгляда — взгляд уступает ему.
      let busy = 0;
      if (this.out && (this.out.def.tracks.headYaw || this.out.def.tracks.headPitch)) busy = smooth(this.out.w);
      if (this.cur && (this.cur.def.tracks.headYaw || this.cur.def.tracks.headPitch)) busy = Math.max(busy, smooth(this.cur.w));
      const k = this.lookW * (1 - busy);
      f.headYaw += this.lookYaw * k;
      f.headPitch += this.lookPitch * k;
      f.torsoYaw += this.lookYaw * k * LOOK_TORSO_SHARE;
    }

    f.bodyY += groundOffset(f.legLPitch, f.legRPitch);
  }

  private apply(): void {
    const f = this.final;
    const r = this.rig;
    r.body.position.y = f.bodyY;
    r.body.rotation.y = f.bodyYaw;
    r.torso.rotation.set(f.torsoPitch, f.torsoYaw, f.torsoRoll);
    r.head.rotation.set(f.headPitch, f.headYaw, f.headRoll);
    r.armL.rotation.set(f.armLPitch, 0, f.armLRoll);
    r.armR.rotation.set(f.armRPitch, 0, f.armRRoll);
    r.legL.rotation.x = f.legLPitch;
    r.legR.rotation.x = f.legRPitch;
  }
}

/** Продвигает жест по времени и ведёт его вес: вверх за fadeIn, вниз — перед концом или сразу, если жест уходит. */
function advance(p: Playing, dt: number): void {
  p.t += dt;
  const fadeIn = p.def.fadeIn ?? DEFAULT_FADE_IN;
  const ending = p.leaving || p.t >= p.def.duration - p.fadeOut;
  p.w = ending ? Math.max(0, p.w - dt / p.fadeOut) : Math.min(1, p.w + dt / fadeIn);
}

/** Подмешивает жест в позу: каналы жеста плавно перекрывают то, что уже есть. */
function blend(f: PoseValues, p: Playing): void {
  const e = smooth(p.w);
  if (e <= 0) return;
  const t = Math.min(p.t, p.def.duration);
  for (const [channel, keys] of p.entries) {
    f[channel] += (sampleTrack(keys, t) - f[channel]) * e;
  }
}
