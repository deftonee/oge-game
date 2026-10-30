/**
 * test-player-reactions.ts — живые реакции персонажа на мир (PlayerReactions).
 *  A. Заглушки: стена («ткнулся» на бегу, «упёрся и стоит», скольжение не в счёт), костёр, «действие» без цели,
 *     занятия от скуки, удерживаемые позы, замороженность в меню и бою, события сундука/барьера/костра.
 *  B. Сквозной сценарий на настоящем игроке: бежит через костёр в стену — подскок, «бонк», почёсывание.
 */
import { NullEngine, Scene, Vector3, MeshBuilder } from "@babylonjs/core";
import { PlayerController } from "../src/core/PlayerController";
import { PlayerReactions } from "../src/core/PlayerReactions";
import type { AlertLevel, ReactionAnimator, ReactionPlayer, ReactionState } from "../src/core/PlayerReactions";
import type { PlayerMotion } from "../src/core/PlayerAnimator";
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
} from "../src/core/playerGestures";
import { ProgressWatcher, countProgress } from "../src/core/progressWatcher";
import { GameState } from "../src/core/GameState";
import { ALL_SPELLS } from "../src/data/spells";
import type { GestureId, HeldId } from "../src/core/playerGestures";

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  }
}

const DT = 1 / 60;

class StubAnimator implements ReactionAnimator {
  public plays: string[] = [];
  public held: HeldId | null = null;
  public isBusy = false;
  public refuse = false;
  private pick = 0;
  play(id: GestureId): boolean {
    if (this.refuse) return false;
    this.plays.push(id);
    return true;
  }
  playOneOf(ids: readonly GestureId[]): GestureId | null {
    if (this.refuse) return null;
    const id = ids[this.pick++ % ids.length];
    this.plays.push(id);
    return id;
  }
  setHeld(id: HeldId | null): void {
    this.held = id;
  }
  public looks: Array<{ yaw: number; pitch: number; strength: number }> = [];
  public cleared = 0;
  /** Последний вызов look/clearLook: null — взгляд отпущен. */
  public gaze: { yaw: number; pitch: number; strength: number } | null = null;
  look(yaw: number, pitch = 0, strength = 1): void {
    this.gaze = { yaw, pitch, strength };
    this.looks.push(this.gaze);
  }
  clearLook(): void {
    this.gaze = null;
    this.cleared++;
  }
  count(id: string): number {
    return this.plays.filter((p) => p === id).length;
  }
  countOf(ids: readonly string[]): number {
    return this.plays.filter((p) => ids.includes(p)).length;
  }
}

interface Rig {
  anim: StubAnimator;
  player: ReactionPlayer & { motion: PlayerMotion; position: { x: number; z: number }; facingYaw: number; faced: Array<[number, number]> };
  fires: Array<{ position: { x: number; z: number } }>;
  witches: Array<{ position: { x: number; z: number }; alertLevel: AlertLevel }>;
  chests: Array<{ position: { x: number; z: number }; isOpened: boolean }>;
  reactions: PlayerReactions;
}
function makeRig(random: () => number = () => 0.5): Rig {
  const anim = new StubAnimator();
  const faced: Array<[number, number]> = [];
  const player = {
    animator: anim,
    motion: { speed: 0, intent: false, progress: 1 } as PlayerMotion,
    position: { x: 0, z: 0 },
    facingYaw: 0,
    faced,
    faceToward: (x: number, z: number) => void faced.push([x, z]),
  };
  const fires: Array<{ position: { x: number; z: number } }> = [];
  const witches: Rig["witches"] = [];
  const chests: Rig["chests"] = [];
  const reactions = new PlayerReactions(player, { activeBonfires: () => fires, activeWitches: () => witches, activeChests: () => chests }, random);
  return { anim, player, fires, witches, chests, reactions };
}
const FREE: ReactionState = { menuOpen: false, inCombat: false, atBonfire: false, hidden: false, powerFraction: 1, section: 0 };
const state = (patch: Partial<ReactionState> = {}): ReactionState => ({ ...FREE, ...patch });

function run(rig: Rig, seconds: number, motion: Partial<PlayerMotion>, st: ReactionState = FREE): void {
  Object.assign(rig.player.motion, motion);
  for (let i = 0; i < Math.round(seconds / DT); i++) rig.reactions.update(DT, st);
}
const RUN: Partial<PlayerMotion> = { speed: 6.5, intent: true, progress: 1 };
const WALL: Partial<PlayerMotion> = { speed: 0, intent: true, progress: 0 };
const STILL: Partial<PlayerMotion> = { speed: 0, intent: false, progress: 1 };

// ---------------------------------------------------------------------------
// A1. Удерживаемые позы
// ---------------------------------------------------------------------------
{
  const r = makeRig();
  run(r, 0.1, STILL, state());
  check(r.anim.held === null, "обычно удерживаемой позы нет");
  run(r, 0.1, STILL, state({ hidden: true }));
  check(r.anim.held !== null && SNEAK_POSES.includes(r.anim.held), "в кустах — крадётся");
  run(r, 0.1, STILL, state({ hidden: true, atBonfire: true, menuOpen: true }));
  check(r.anim.held !== null && SIT_POSES.includes(r.anim.held), "у костра сидит (важнее, чем крадётся)");
  run(r, 0.1, STILL, state({ hidden: true, atBonfire: true, inCombat: true, menuOpen: true }));
  check(r.anim.held !== null && STANCE_POSES.includes(r.anim.held), "в бою — боевая стойка (важнее всего)");
  run(r, 0.1, STILL, state());
  check(r.anim.held === null, "бой кончился — поза снята");
}

{
  // Вариант позы выбирается один раз при входе в состояние и держится до выхода; в следующий раз — другой.
  let seed = 11;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const r = makeRig(rnd);
  for (const [name, pool, st] of [["сидит", SIT_POSES, state({ atBonfire: true, menuOpen: true })], ["стойка", STANCE_POSES, state({ inCombat: true, menuOpen: true })], ["крадётся", SNEAK_POSES, state({ hidden: true })]] as const) {
    const seen = new Set<string>();
    let last = "";
    let repeats = 0;
    let stable = true;
    for (let i = 0; i < 40; i++) {
      run(r, 0.05, STILL, st);
      const first = r.anim.held!;
      run(r, 0.5, STILL, st);
      if (r.anim.held !== first) stable = false;
      seen.add(first);
      if (first === last) repeats++;
      last = first;
      run(r, 0.05, STILL, FREE);
    }
    check(seen.size === pool.length, `${name}: за 40 входов встретились все ${pool.length} варианта позы`);
    check(repeats === 0, `${name}: одна и та же поза не выпадает дважды подряд`);
    check(stable, `${name}: пока состояние длится, поза не меняется`);
  }
}

// ---------------------------------------------------------------------------
// A2. Стена
// ---------------------------------------------------------------------------
{
  // Налетел на бегу: бонк один раз, дальше — почёсывание/плечи/фейспалм один раз.
  const r = makeRig();
  run(r, 0.5, RUN);
  run(r, 0.1, WALL);
  check(r.anim.countOf(BONK_GESTURES) === 1, "налетел на стену на бегу — «бонк»");
  run(r, 0.5, WALL);
  check(r.anim.countOf(BONK_GESTURES) === 1, "пока давит в стену, «бонк» не повторяется");
  check(r.anim.countOf(STUCK_GESTURES) === 0, "сразу после удара «упёрся и стоит» ещё не срабатывает");

  // Отпустил, разбежался, снова ударился — но пауза («кулдаун») ещё не прошла.
  run(r, 0.2, STILL);
  run(r, 0.4, RUN);
  run(r, 0.2, WALL);
  check(r.anim.countOf(BONK_GESTURES) === 1, "повторный удар сразу после первого «бонк» не вызывает (кулдаун)");

  // Давит дальше — упёрся и стоит.
  run(r, 1.3, WALL);
  check(r.anim.countOf(STUCK_GESTURES) === 1, "давит в стену дольше секунды — чешет голову / жмёт плечами / фейспалм");
  run(r, 3, WALL);
  check(r.anim.countOf(STUCK_GESTURES) === 1 && r.anim.countOf(BONK_GESTURES) === 1, "дальше не повторяется, пока давит");

  // После паузы можно снова.
  run(r, 3, STILL);
  run(r, 0.4, RUN);
  run(r, 0.2, WALL);
  check(r.anim.countOf(BONK_GESTURES) === 2, "после паузы снова ткнулся — снова «бонк»");
}
{
  // Подошёл к стене шагом: не «ткнулся», но если давит — почешет голову.
  const r = makeRig();
  run(r, 0.5, { speed: 1.5, intent: true, progress: 1 });
  run(r, 0.3, WALL);
  check(r.anim.countOf(BONK_GESTURES) === 0, "подошёл к стене медленно — «бонка» нет");
  run(r, 1.2, WALL);
  check(r.anim.countOf(STUCK_GESTURES) === 1, "но давит в стену — всё равно чешет голову");
}
{
  // Скользит вдоль стены под углом: не упёрся.
  const r = makeRig();
  run(r, 0.5, RUN);
  run(r, 4, { speed: 4.5, intent: true, progress: 0.5 });
  check(r.anim.plays.length === 0, "скольжение вдоль стены — ни «бонка», ни почёсывания");
  // Стоит рядом со стеной и не жмёт.
  run(r, 4, STILL);
  check(r.anim.countOf(BONK_GESTURES) === 0 && r.anim.countOf(STUCK_GESTURES) === 0, "стоит у стены и ничего не жмёт — реакции нет");
}
{
  // Аниматор отказал (играет более важный жест): кулдаун не тратится, реакция придёт позже.
  const r = makeRig();
  r.anim.refuse = true;
  run(r, 0.5, RUN);
  run(r, 0.2, WALL);
  check(r.anim.countOf(BONK_GESTURES) === 0, "аниматор отказал — «бонка» нет");
  r.anim.refuse = false;
  run(r, 0.1, STILL);
  run(r, 0.5, RUN);
  run(r, 0.2, WALL);
  check(r.anim.countOf(BONK_GESTURES) === 1, "кулдаун за отказанный жест не тратится");
}

// ---------------------------------------------------------------------------
// A3. Костёр
// ---------------------------------------------------------------------------
{
  const r = makeRig();
  r.fires.push({ position: { x: 4, z: 0 } }, { position: { x: 10, z: 10 } });
  run(r, 1, STILL);
  check(r.anim.countOf(BURN_GESTURES) === 0, "костёр далеко — ничего");
  r.player.position.x = 3.1;
  run(r, 0.1, STILL);
  check(r.anim.countOf(BURN_GESTURES) === 0, "рядом с костром (0.9 м), но не на нём — ничего");
  r.player.position.x = 3.5;
  run(r, 0.05, STILL);
  check(r.anim.countOf(BURN_GESTURES) === 1, "наступил на костёр (0.5 м от центра) — подскок");
  run(r, 1.0, STILL);
  check(r.anim.countOf(BURN_GESTURES) === 1, "стоит в огне — пауза между подскоками");
  run(r, 0.7, STILL);
  check(r.anim.countOf(BURN_GESTURES) === 2, "стоит в огне дальше — снова подскакивает");
  r.player.position.x = 0;
  run(r, 3, STILL);
  check(r.anim.countOf(BURN_GESTURES) === 2, "ушёл из огня — подскоков больше нет");
  // Второй костёр тоже жжётся.
  r.player.position.x = 10;
  r.player.position.z = 10.3;
  run(r, 0.1, STILL);
  check(r.anim.countOf(BURN_GESTURES) === 3, "любой из активных костров обжигает");
}
{
  const r = makeRig();
  r.fires.push({ position: { x: 0, z: 0 } });
  r.anim.refuse = true;
  run(r, 0.3, STILL);
  check(r.anim.plays.length === 0, "аниматор отказал — подскока нет");
  r.anim.refuse = false;
  run(r, 0.05, STILL);
  check(r.anim.countOf(BURN_GESTURES) === 1, "как только аниматор свободен, подскок происходит сразу");
}
{
  // В бою и в меню костёр не жжётся.
  const r = makeRig();
  r.fires.push({ position: { x: 0, z: 0 } });
  run(r, 2, STILL, state({ inCombat: true, menuOpen: true }));
  run(r, 2, STILL, state({ menuOpen: true }));
  check(r.anim.countOf(BURN_GESTURES) === 0, "в бою и в меню персонаж костёр не «чувствует»");
}

// ---------------------------------------------------------------------------
// A4. «Действие» без цели
// ---------------------------------------------------------------------------
{
  const r = makeRig();
  run(r, 0.1, STILL);
  const id = r.reactions.onIdleInteract();
  check(id !== null && IDLE_ACTION_GESTURES.includes(id), `«действие» без цели — жест из набора (${id})`);
  const seen = new Set<string>();
  for (let i = 0; i < IDLE_ACTION_GESTURES.length * 2; i++) seen.add(r.reactions.onIdleInteract() ?? "");
  check(IDLE_ACTION_GESTURES.every((g) => seen.has(g)), "повторные нажатия перебирают весь набор занятий");
  check(IDLE_ACTION_GESTURES.length >= 5 && IDLE_ACTION_GESTURES.includes("sit") && IDLE_ACTION_GESTURES.includes("scratchHead"), "в наборе есть «почесал голову» и «сел посидеть»");

  run(r, 0.1, { speed: 4, intent: true, progress: 1 });
  check(r.reactions.onIdleInteract() === null, "на бегу «действие» без цели ничего не делает");
  run(r, 0.1, STILL, state({ menuOpen: true }));
  check(r.reactions.onIdleInteract() === null, "при открытом меню — тоже");
  run(r, 0.1, STILL, state({ menuOpen: true, inCombat: true }));
  check(r.reactions.onIdleInteract() === null, "в бою — тоже");
  run(r, 0.1, STILL);
  check(r.reactions.onIdleInteract() !== null, "меню закрыто — снова работает");
  r.anim.refuse = true;
  check(r.reactions.onIdleInteract() === null, "аниматор отказал — null");
}

// ---------------------------------------------------------------------------
// A5. Занятия от скуки
// ---------------------------------------------------------------------------
{
  const r = makeRig(() => 0); // первая пауза — ровно 9 с
  run(r, 8.5, STILL);
  check(r.anim.plays.length === 0, "стоит меньше 9 с — ничего");
  run(r, 0.8, STILL);
  check(r.anim.countOf(FIDGET_GESTURES) === 1, "простоял ~9 с — занял себя сам");
  run(r, 8.5, STILL);
  check(r.anim.countOf(FIDGET_GESTURES) === 1, "и следующая пауза снова отсчитывается заново");
  run(r, 1.0, STILL);
  check(r.anim.countOf(FIDGET_GESTURES) === 2, "…и срабатывает снова");
}
{
  const r = makeRig(() => 0);
  run(r, 8, STILL);
  run(r, 0.2, RUN);
  run(r, 8, STILL);
  check(r.anim.countOf(FIDGET_GESTURES) === 0, "любое движение обнуляет счётчик скуки");
  run(r, 2, STILL, state({ hidden: true }));
  run(r, 10, STILL, state({ hidden: true }));
  check(r.anim.countOf(FIDGET_GESTURES) === 0, "в кустах не скучает (прячется)");
  run(r, 12, STILL, state({ menuOpen: true }));
  run(r, 12, STILL, state({ menuOpen: true, inCombat: true }));
  check(r.anim.countOf(FIDGET_GESTURES) === 0, "в меню и бою не скучает");
  r.anim.isBusy = true;
  run(r, 12, STILL);
  check(r.anim.countOf(FIDGET_GESTURES) === 0, "пока играет другой жест, новый «от скуки» не запускается");
  r.anim.isBusy = false;
  run(r, 9.5, STILL);
  check(r.anim.countOf(FIDGET_GESTURES) === 1, "освободился — скука снова считается");
  // Разброс пауз: от 9 до 18 с.
  const slow = makeRig(() => 0.999);
  run(slow, 17.5, STILL);
  check(slow.anim.plays.length === 0, "при максимальном разбросе пауза ≈ 18 с");
  run(slow, 1, STILL);
  check(slow.anim.countOf(FIDGET_GESTURES) === 1, "…и всё равно срабатывает");
}

// ---------------------------------------------------------------------------
// A6. События мира
// ---------------------------------------------------------------------------
{
  const r = makeRig();
  r.reactions.onBonfireOpened(3, 4);
  check(r.player.faced.length === 1 && r.player.faced[0][0] === 3 && r.player.faced[0][1] === 4, "у костра — лицом к огню");
  r.reactions.onChestOpened(1, 2);
  check(r.player.faced.length === 2 && r.anim.countOf(CHEST_GESTURES) === 1, "сундук: повернулся к нему и склонился над крышкой");
  r.reactions.onGateOpened(5, 6);
  check(r.player.faced.length === 3 && r.anim.countOf(GATE_PUSH_GESTURES) === 1, "барьер: повернулся к нему и упёрся ладонями");
}

// ---------------------------------------------------------------------------
// A7. Заметила ведьма
// ---------------------------------------------------------------------------
{
  const r = makeRig();
  const witch = { position: { x: 10, z: 0 }, alertLevel: "none" as AlertLevel };
  r.witches.push(witch);
  run(r, 1, STILL);
  check(r.anim.countOf(ALERT_GESTURES) === 0, "спокойная ведьма поблизости — героя не пугает");
  witch.alertLevel = "notice";
  run(r, 0.3, STILL);
  check(r.anim.countOf(ALERT_GESTURES) === 1, "ведьма заметила героя — он вздрагивает / сглатывает / оглядывается");
  run(r, 2, STILL);
  witch.alertLevel = "chase";
  run(r, 0.5, STILL);
  check(r.anim.countOf(ALERT_GESTURES) === 1, "переход «заметила → гонится» в пределах паузы второй реакции не вызывает");
  run(r, 1.5, STILL);
  witch.alertLevel = "search";
  run(r, 0.5, STILL);
  check(r.anim.countOf(RELIEF_GESTURES) === 1, "погоня оборвалась (ведьма потеряла героя) — он выдыхает");
  witch.alertLevel = "none";
  run(r, 0.5, STILL);
  check(r.anim.countOf(RELIEF_GESTURES) === 1, "а когда ведьма совсем успокоилась — второго выдоха нет");
  run(r, 7, STILL);
  witch.alertLevel = "notice";
  run(r, 0.3, STILL);
  check(r.anim.countOf(ALERT_GESTURES) === 2, "через паузу герой снова пугается");
}
{
  // В кустах — замирает, а не вздрагивает.
  const r = makeRig();
  const witch = { position: { x: 8, z: 0 }, alertLevel: "chase" as AlertLevel };
  r.witches.push(witch);
  run(r, 0.3, STILL, state({ hidden: true }));
  check(r.anim.countOf(HIDDEN_ALERT_GESTURES) === 1 && r.anim.countOf(ALERT_GESTURES) === 0, "в кустах заметили — герой замирает (затаил дыхание / прижал руки / выглядывает)");
}
{
  // Далёкая ведьма не пугает.
  const r = makeRig();
  r.witches.push({ position: { x: 45, z: 0 }, alertLevel: "chase" });
  run(r, 1, STILL);
  check(r.anim.countOf(ALERT_GESTURES) === 0 && r.anim.gaze === null, "ведьма в 45 м героя не волнует и он на неё не смотрит");
}
{
  // Конец боя после погони не похож на «ушёл от погони».
  const r = makeRig();
  const witch = { position: { x: 6, z: 0 }, alertLevel: "chase" as AlertLevel };
  r.witches.push(witch);
  run(r, 0.3, STILL);
  const before = r.anim.countOf(RELIEF_GESTURES);
  run(r, 2, STILL, state({ inCombat: true, menuOpen: true }));
  witch.alertLevel = "none";
  run(r, 1, STILL);
  check(r.anim.countOf(RELIEF_GESTURES) === before, "после боя (ведьма побеждена) герой не «выдыхает от погони» поверх победного жеста");
}

// ---------------------------------------------------------------------------
// A8. Взгляд: голова поворачивается к ведьме и к нетронутому сундуку
// ---------------------------------------------------------------------------
{
  const r = makeRig();
  const witch = { position: { x: 5, z: 5 }, alertLevel: "notice" as AlertLevel };
  r.witches.push(witch);
  run(r, 0.3, STILL);
  check(r.anim.gaze !== null && Math.abs(r.anim.gaze.yaw - Math.PI / 4) < 0.01 && r.anim.gaze.strength > 0.9, "смотрит на заметившую ведьму (45° вправо)");
  r.player.facingYaw = 1.0;
  run(r, 0.05, STILL);
  check(r.anim.gaze !== null && Math.abs(r.anim.gaze.yaw - (Math.PI / 4 - 1.0)) < 0.01, "угол взгляда считается от курса тела: повернулся к ней — голова выровнялась");
  r.player.facingYaw = 0;
  witch.position = { x: 0, z: -6 };
  run(r, 0.3, STILL);
  check(r.anim.gaze === null, "ведьма почти за спиной — головой не оборачивается");
  witch.position = { x: -4, z: 3 };
  run(r, 0.3, STILL);
  check(r.anim.gaze !== null && r.anim.gaze.yaw < -0.5, "ведьма слева — голова влево");
  witch.alertLevel = "none";
  run(r, 0.3, STILL);
  check(r.anim.gaze === null, "ведьма успокоилась — взгляд отпущен");
  witch.alertLevel = "notice";
  witch.position = { x: 0.1, z: 0.2 };
  run(r, 0.3, STILL);
  check(r.anim.gaze === null, "ведьма вплотную — не косимся на неё");
}
{
  const r = makeRig();
  const chest = { position: { x: 3, z: 4 }, isOpened: false };
  r.chests.push(chest);
  run(r, 0.3, STILL);
  check(r.anim.gaze !== null && r.anim.gaze.strength > 0.5 && r.anim.gaze.strength < 0.9, "нетронутый сундук рядом — косится, но слабее, чем на ведьму");
  chest.isOpened = true;
  run(r, 0.3, STILL);
  check(r.anim.gaze === null, "сундук открыт — не интересен");
  chest.isOpened = false;
  chest.position = { x: 12, z: 0 };
  run(r, 0.3, STILL);
  check(r.anim.gaze === null, "сундук далеко (12 м) — не интересен");
  chest.position = { x: 3, z: 4 };
  run(r, 0.3, STILL, state({ hidden: true }));
  check(r.anim.gaze === null, "в кустах по сторонам не глазеет");
  run(r, 0.3, STILL, state({ menuOpen: true }));
  check(r.anim.gaze === null, "в меню взгляд отпущен");
  run(r, 0.3, STILL);
  check(r.anim.gaze !== null, "меню закрыли — снова косится");
  r.witches.push({ position: { x: -5, z: 0 }, alertLevel: "chase" });
  run(r, 0.3, STILL);
  check(r.anim.gaze !== null && r.anim.gaze.yaw < 0 && r.anim.gaze.strength > 0.9, "ведьма важнее сундука: смотрит на неё");
}

// ---------------------------------------------------------------------------
// A9. Нырнул в куст
// ---------------------------------------------------------------------------
{
  const r = makeRig();
  run(r, 0.3, STILL);
  check(r.anim.countOf(HIDE_GESTURES) === 0, "на открытом месте не пригибается");
  run(r, 0.3, STILL, state({ hidden: true }));
  check(r.anim.countOf(HIDE_GESTURES) === 1, "нырнул в куст — пригнулся (один из вариантов)");
  run(r, 2, STILL, state({ hidden: true }));
  check(r.anim.countOf(HIDE_GESTURES) === 1, "сидит в кусте — повторно не ныряет");
  run(r, 0.3, STILL);
  run(r, 0.3, STILL, state({ hidden: true }));
  check(r.anim.countOf(HIDE_GESTURES) === 2, "вышел и нырнул снова — снова пригнулся");
  const f = makeRig();
  run(f, 0.3, STILL, state({ hidden: true, menuOpen: true }));
  check(f.anim.countOf(HIDE_GESTURES) === 0, "в меню или бою нырок не показывается");
}

// ---------------------------------------------------------------------------
// A10. Усталость
// ---------------------------------------------------------------------------
{
  const r = makeRig(() => 0);
  run(r, 0.2, STILL, state({ powerFraction: 0.6 }));
  check(r.anim.held === null, "Сила в порядке — поза обычная");
  run(r, 0.2, STILL, state({ powerFraction: 0.2 }));
  check(r.anim.held !== null && WEARY_POSES.includes(r.anim.held), "Сила на исходе — плечи опущены");
  run(r, 0.2, STILL, state({ powerFraction: 0.32 }));
  check(r.anim.held !== null && WEARY_POSES.includes(r.anim.held), "Сила чуть выросла, но ещё мало — поза не дёргается на границе");
  run(r, 4, STILL, state({ powerFraction: 0.3 }));
  check(r.anim.countOf(TIRED_GESTURES) >= 1 && r.anim.countOf(FIDGET_GESTURES) === 0, "уставший стоит — тяжело дышит и вытирает пот (а не зевает и разминается)");
  run(r, 0.2, STILL, state({ powerFraction: 0.5, inCombat: true, menuOpen: true }));
  check(r.anim.held !== null && STANCE_POSES.includes(r.anim.held), "в бою стойка важнее усталости");
  const before = r.anim.countOf(REFRESHED_GESTURES);
  run(r, 0.2, STILL, state({ powerFraction: 0.5 }));
  check(r.anim.held === null && r.anim.countOf(REFRESHED_GESTURES) === before, "после боя отдых без жеста: он был заморожен, потягиваться не с чего");
}
{
  const r = makeRig();
  run(r, 0.2, STILL, state({ powerFraction: 0.1 }));
  run(r, 0.2, STILL, state({ powerFraction: 0.7 }));
  check(r.anim.countOf(REFRESHED_GESTURES) === 1 && r.anim.held === null, "Сила восстановилась — потянулся и выпрямился");
  const m = makeRig();
  run(m, 0.2, STILL, state({ powerFraction: 0.1 }));
  run(m, 0.2, RUN, state({ powerFraction: 0.7 }));
  check(m.anim.countOf(REFRESHED_GESTURES) === 0, "если Сила восстановилась на бегу — потягиваться не останавливается");
}

// ---------------------------------------------------------------------------
// A11. Новое место
// ---------------------------------------------------------------------------
{
  const r = makeRig();
  run(r, 0.2, STILL, state({ section: 3 }));
  check(r.anim.countOf(ARRIVAL_GESTURES) === 0, "на старте (секция 3) герой не «приходит в новое место»");
  run(r, 0.2, RUN, state({ section: 4 }));
  check(r.anim.countOf(ARRIVAL_GESTURES) === 1, "вошёл в новую, дальше всех, секцию — оглядывает её");
  run(r, 0.2, RUN, state({ section: 3 }));
  run(r, 0.2, RUN, state({ section: 4 }));
  check(r.anim.countOf(ARRIVAL_GESTURES) === 1, "вернулся и снова зашёл в уже виденную секцию — ничего");
  run(r, 0.2, RUN, state({ section: 5 }));
  check(r.anim.countOf(ARRIVAL_GESTURES) === 2, "следующая новая секция — снова");
  run(r, 0.2, STILL, state({ section: 6, menuOpen: true }));
  run(r, 0.2, STILL, state({ section: 6 }));
  check(r.anim.countOf(ARRIVAL_GESTURES) === 2, "если секция сменилась, пока герой был в меню, задним числом не оглядывается");
  run(r, 0.2, STILL, state({ section: 7, hidden: true }));
  check(r.anim.countOf(ARRIVAL_GESTURES) === 2, "в кустах не высматривает даль");
}

// ---------------------------------------------------------------------------
// A12. Прогресс: заклинание, барьер, находка
// ---------------------------------------------------------------------------
{
  const r = makeRig();
  r.reactions.onProgress({ spellLearned: true, gateOpened: false, treasure: false });
  check(r.anim.countOf(LEARNED_GESTURES) === 1, "выучил заклинание — радуется");
  r.reactions.onProgress({ spellLearned: false, gateOpened: true, treasure: false });
  check(r.anim.countOf(GATE_OPENED_GESTURES) === 1, "разрушил барьер — радуется по-своему");
  r.reactions.onProgress({ spellLearned: false, gateOpened: false, treasure: false });
  check(r.anim.plays.length === 2, "ничего не прибавилось — ничего и не происходит");
  r.reactions.onProgress({ spellLearned: false, gateOpened: false, treasure: true });
  check(r.anim.countOf(TREASURE_GESTURES) === 0, "находку не показываем сразу: сначала открывается крышка");
  run(r, 1.0, STILL);
  check(r.anim.countOf(TREASURE_GESTURES) === 0, "…и через секунду ещё рано");
  run(r, 0.6, STILL);
  check(r.anim.countOf(TREASURE_GESTURES) === 1, "через полторы секунды любуется находкой");
  run(r, 3, STILL);
  check(r.anim.countOf(TREASURE_GESTURES) === 1, "ровно один раз");
  r.reactions.onProgress({ spellLearned: false, gateOpened: false, treasure: true });
  run(r, 2, STILL, state({ menuOpen: true }));
  check(r.anim.countOf(TREASURE_GESTURES) === 2, "находка показывается, даже если открыто окно добычи");
}
{
  // Наблюдатель прогресса на настоящем GameState.
  const gs = new GameState();
  const watcher = new ProgressWatcher(() => countProgress(gs));
  const none = watcher.poll();
  check(!none.spellLearned && !none.gateOpened && !none.treasure, "наблюдатель: на старте ничего не прибавилось");
  const unlearned = ALL_SPELLS.find((s) => !gs.isLearned(s.id))!;
  gs.learn(unlearned.id);
  const learned = watcher.poll();
  check(learned.spellLearned && !learned.gateOpened && !learned.treasure, "наблюдатель: выучено заклинание");
  check(!watcher.poll().spellLearned, "наблюдатель: событие приходит один раз");
  gs.openGate("g-1");
  check(watcher.poll().gateOpened, "наблюдатель: открыт барьер");
  gs.collectBookPage("page-1");
  check(watcher.poll().treasure, "наблюдатель: найдена страница");
  gs.collectBook("book-1");
  check(watcher.poll().treasure, "наблюдатель: найдена книга");
  gs.restore({ learned: [], mastery: {}, defeatedWitchIds: [], openedGateIds: [], openedChestIds: [], bookPageIds: [], bookIds: [], chestLoot: {} });
  const after = watcher.poll();
  check(!after.spellLearned && !after.gateOpened && !after.treasure, "наблюдатель: загрузка меньшего прогресса — не повод радоваться");
  gs.openGate("g-2");
  check(watcher.poll().gateOpened, "наблюдатель: после загрузки новая точка отсчёта — следующий барьер снова радует");
  // Загруженный прогресс не радует, если наблюдатель создан после загрузки.
  const loaded = new GameState();
  loaded.openGate("a");
  loaded.collectBookPage("p");
  const late = new ProgressWatcher(() => countProgress(loaded));
  const l = late.poll();
  check(!l.gateOpened && !l.treasure, "наблюдатель: прогресс, загруженный до его создания, радости не вызывает");
}

// ---------------------------------------------------------------------------
// B. Сквозной сценарий на настоящем игроке
// ---------------------------------------------------------------------------
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.collisionsEnabled = true;
  const floor = MeshBuilder.CreateBox("floor", { width: 40, height: 1, depth: 40 }, scene);
  floor.position.y = -0.5;
  floor.checkCollisions = true;
  const wall = MeshBuilder.CreateBox("wall", { width: 20, height: 4, depth: 1 }, scene);
  wall.position.set(0, 2, 8);
  wall.checkCollisions = true;
  // Без рендера (NullEngine) мировые матрицы не обновляются сами — в игре это делает scene.render().
  floor.computeWorldMatrix(true);
  wall.computeWorldMatrix(true);

  const keys = new Set<string>();
  const pc = new PlayerController(scene, new Vector3(0, 0.05, 0), { isDown: (a) => keys.has(a) });
  const fire = { position: { x: 0, z: 3 } };
  const witches: Array<{ position: { x: number; z: number }; alertLevel: AlertLevel }> = [];
  const reactions = new PlayerReactions(pc, { activeBonfires: () => [fire], activeWitches: () => witches }, () => 0);
  const forward = new Vector3(0, 0, 1);
  const right = new Vector3(1, 0, 0);
  const timeline: string[] = [];
  const stepAll = (seconds: number, st: ReactionState = FREE): void => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      pc.collider.computeWorldMatrix(true);
      pc.update(DT, forward, right);
      reactions.update(DT, st);
      const g = pc.animator.currentGesture;
      if (g && timeline[timeline.length - 1] !== g) timeline.push(g);
    }
  };

  stepAll(0.5);
  check(timeline.length === 0, "на старте стоит спокойно");
  keys.add("moveForward");
  stepAll(0.35);
  check(timeline.length === 0, "бежит, пока до костра далеко — жестов нет");
  stepAll(0.4);
  check(timeline.length > 0 && BURN_GESTURES.includes(timeline[0] as GestureId), `пробежал по костру — подскок (${timeline[0]})`);
  stepAll(1.2);
  check(timeline.some((g) => BONK_GESTURES.includes(g as GestureId)), "добежал до стены — «бонк» (один из вариантов)");
  const afterBonk = timeline.length;
  stepAll(1.6);
  check(timeline.length > afterBonk && STUCK_GESTURES.includes(timeline[timeline.length - 1] as GestureId), `давит в стену — почёсывается / жмёт плечами / фейспалм (${timeline[timeline.length - 1]})`);
  keys.clear();

  // Нажал «действие» стоя на месте.
  stepAll(3);
  const idle = reactions.onIdleInteract();
  check(idle !== null && pc.animator.currentGesture === idle, `«действие» без цели на настоящем аниматоре: играет «${idle}»`);
  stepAll(5);
  check(pc.animator.currentGesture === null && !pc.animator.isBusy, "занятие заканчивается само");

  // У костра персонаж садится и встаёт, когда меню закрылось.
  stepAll(1.2, state({ atBonfire: true, menuOpen: true }));
  check(pc.animator.heldPose !== null && SIT_POSES.includes(pc.animator.heldPose) && pc.animator.pose.bodyY < -0.4, "меню костра открыто — персонаж сидит на земле");
  stepAll(1.2, FREE);
  check(pc.animator.heldPose === null && Math.abs(pc.animator.pose.bodyY) < 0.02, "меню закрыли — встал");

  // Ведьма справа заметила героя: он вздрагивает и поворачивает к ней голову, потом отпускает.
  witches.push({ position: { x: pc.position.x + 6, z: pc.position.z + 2 }, alertLevel: "notice" });
  timeline.length = 0;
  stepAll(1.0);
  check(ALERT_GESTURES.includes(timeline[0] as GestureId), `заметила ведьма — герой реагирует (${timeline[0]})`);
  stepAll(1.2); // испуг доигран (жест, который сам ведёт голову, важнее взгляда)
  const wanted = Math.atan2(6, 2) - pc.facingYaw;
  check(pc.animator.lookWeight > 0.5 && Math.sign(pc.animator.pose.headYaw) === Math.sign(Math.atan2(Math.sin(wanted), Math.cos(wanted))), "голова повёрнута к ведьме (в её сторону)");
  witches[0].alertLevel = "none";
  stepAll(1.6);
  check(pc.animator.lookWeight < 0.02 && Math.abs(pc.animator.pose.headYaw) < 0.05, "ведьма успокоилась — голова вернулась");
  witches.length = 0;

  // В бою — стойка.
  stepAll(1, state({ inCombat: true, menuOpen: true }));
  check(pc.animator.heldPose !== null && STANCE_POSES.includes(pc.animator.heldPose) && Math.abs(pc.animator.pose.legLPitch) > 0.1, "в бою — боевая стойка, ноги расставлены");
  stepAll(1, FREE);

  pc.collider.dispose();
  engine.dispose();
}

console.log(failures === 0 ? `OK: реакции персонажа — ${checks} проверок (стена, костёр, «действие», скука, позы, сквозной сценарий)` : `ПРОВАЛОВ: ${failures} из ${checks}`);
process.exit(failures === 0 ? 0 : 1);
