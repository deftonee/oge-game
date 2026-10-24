// Бой на шкалах Силы целиком: настоящий CombatManager + DOM (happy-dom) + сцена-заглушка.
// Проверяем порядок ходов (кто бьёт первым), расход Силы, усталость заклинаний, победу/поражение/отступление,
// «тренировочные» цели без ответных ударов и устойчивость к сбоям 3D-сцены.
// Запуск: npm run test:combat-flow.
import { Window } from "happy-dom";
import { CombatManager } from "../src/combat/CombatManager";
import { NULL_BATTLE_STAGE } from "../src/combat/BattleStage";
import type { BattleStage, Strike } from "../src/combat/BattleStage";
import { createOpponentFactory } from "../src/combat/opponent";
import type { BattleOpponent, BattleOutcome } from "../src/combat/opponent";
import { PowerPool } from "../src/combat/PowerPool";
import { SpellFatigue } from "../src/combat/SpellFatigue";
import { spellDamage } from "../src/combat/damage";
import { efficiencyLevel, efficiencyPercent } from "../src/combat/CombatView";
import { PLAYER_MAX_POWER, PRACTICE_TARGET_POWER, TRAINING_WITCH_POWER, WITCH_HIT_DAMAGE, WITCH_POWER } from "../src/combat/combatBalance";
import { witchPowerFor } from "../src/core/duelRules";
import { GameState, MAX_MASTERY } from "../src/core/GameState";
import { Hud } from "../src/core/Hud";
import { ALL_SPELLS, getSpellById } from "../src/data/spells";

declare const process: { exit(code?: number): never };

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

const win = new Window({ url: "http://localhost/" });
const g = globalThis as unknown as Record<string, unknown>;
g.window = win;
g.document = win.document;
const doc = win.document;

function freshRoot(): HTMLElement {
  doc.body.innerHTML = "";
  const root = doc.createElement("div");
  doc.body.appendChild(root);
  return root as unknown as HTMLElement;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// ---------- Заглушки сцены ----------

class RecordingStage implements BattleStage {
  public events: string[] = [];
  public strikes: Array<{ from: string; spell: string; result: string }> = [];
  public afterImpact: ((s: Strike) => void) | null = null;
  begin(): void {
    this.events.push("begin");
  }
  strike(s: Strike): Promise<void> {
    this.strikes.push({ from: s.from, spell: s.spell.id, result: s.result });
    s.onImpact?.();
    this.afterImpact?.(s);
    return Promise.resolve();
  }
  end(): void {
    this.events.push("end");
  }
}

// ---------- Противники ----------

const WITCH_SPELL = getSpellById("velocity"); // ведьма на «механике», игрок бьёт «огнём»

function fakeOpponent(over: Partial<Pick<BattleOpponent, "maxPower" | "playerStrikesFirst" | "openingNote" | "attackSpell" | "playerAttackRole">> & { kind?: "witch" | "target"; id?: string } = {}): BattleOpponent {
  const kind = over.kind ?? "witch";
  const base = {
    id: over.id ?? "opp1",
    title: kind === "witch" ? "Ведьма Тест" : "Чучело",
    anchor: {} as never,
    maxPower: over.maxPower ?? 90,
    attackSpell: over.attackSpell === undefined ? (kind === "witch" ? WITCH_SPELL : null) : over.attackSpell,
    playerAttackRole: over.playerAttackRole ?? (kind === "witch" ? "attackWitch" : "staticTarget"),
    playerStrikesFirst: over.playerStrikesFirst ?? true,
    openingNote: over.openingNote ?? null,
    messages: { attackBadge: "Атака ведьмы", noSpells: "Нечем бить, отступай.", won: "Победили!", lost: "Проиграли." },
  } as const;
  return (kind === "witch" ? { kind, witch: { id: base.id } as never, ...base } : { kind, target: { id: base.id } as never, ...base }) as BattleOpponent;
}

// ---------- Окружение боя ----------

interface Env {
  root: HTMLElement;
  gs: GameState;
  power: PowerPool;
  fatigue: SpellFatigue;
  stage: RecordingStage;
  combat: CombatManager;
  ended: Array<{ id: string; kind: string; outcome: BattleOutcome }>;
}

function setup(opts: { learn?: string[]; stage?: BattleStage } = {}): Env {
  const root = freshRoot();
  const gs = new GameState();
  for (const id of opts.learn ?? ["spark", "flame"]) gs.learn(id);
  const power = new PowerPool(PLAYER_MAX_POWER);
  const fatigue = new SpellFatigue();
  const stage = (opts.stage as RecordingStage | undefined) ?? new RecordingStage();
  const ended: Env["ended"] = [];
  const combat = new CombatManager(
    root,
    { gameState: gs, playerPower: power, fatigue, stage, timing: { feedbackOkMs: 0, feedbackFailMs: 0 }, random: () => 0 },
    { onBattleEnd: (o, outcome) => ended.push({ id: o.id, kind: o.kind, outcome }) }
  );
  return { root, gs, power, fatigue, stage, combat, ended };
}

// ---------- «Руки» игрока ----------

type Screen = "pick" | "question" | "result";

/** Что сейчас можно нажимать: окно выбора, окно вопроса (поле не заблокировано) или итог; спрятанное на время удара окно не в счёт. */
function actionable(root: HTMLElement): Screen | null {
  const overlay = root.querySelector(".combat-overlay") as HTMLElement | null;
  if (!overlay || overlay.classList.contains("combat-overlay--fx")) return null;
  if (overlay.querySelector(".combat-result-title")) return "result";
  const input = overlay.querySelector(".combat-answer-input") as HTMLInputElement | null;
  if (input) return input.disabled ? null : "question";
  if (overlay.querySelector(".combat-retreat")) return "pick";
  return null;
}

async function waitFor(env: Env, screen: Screen, what: string): Promise<boolean> {
  for (let i = 0; i < 300; i++) {
    if (actionable(env.root) === screen) return true;
    await tick();
  }
  failures++;
  checks++;
  console.error(`FAIL: не дождались экрана «${screen}» (${what}); сейчас: ${actionable(env.root)}`);
  return false;
}

const QUESTION_BY_TEXT = new Map(ALL_SPELLS.flatMap((s) => s.questions.map((q) => [q.text, q] as const)));

const text = (root: HTMLElement, sel: string): string => (root.querySelector(sel)?.textContent ?? "").trim();
const badge = (root: HTMLElement): string => text(root, ".combat-badge");

function answer(root: HTMLElement, correct: boolean): void {
  const q = QUESTION_BY_TEXT.get(text(root, ".combat-question"));
  if (!q) throw new Error(`вопрос не найден: ${text(root, ".combat-question")}`);
  const input = root.querySelector(".combat-answer-input") as HTMLInputElement;
  input.value = String(correct ? q.answer : q.answer + 12345);
  (root.querySelector(".combat-submit") as HTMLButtonElement).click();
}

function spellOptions(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll(".bonfire-spell-option")) as HTMLElement[];
}

function optionNamed(root: HTMLElement, spellId: string): HTMLElement | undefined {
  const name = getSpellById(spellId).name;
  return spellOptions(root).find((o) => (o.querySelector(".bonfire-spell-name")?.textContent ?? "") === name);
}

function pickSpell(root: HTMLElement, spellId: string): void {
  const option = optionNamed(root, spellId);
  if (!option) throw new Error(`в списке нет заклинания ${spellId}`);
  option.click();
}

const retreat = (root: HTMLElement): void => (root.querySelector(".combat-retreat") as HTMLButtonElement).click();
const proceed = (root: HTMLElement): void => (root.querySelector(".combat-submit") as HTMLButtonElement).click();

const bar = (root: HTMLElement, side: "player" | "opponent"): number => Number(text(root, `.battle-bar-line.${side} .battle-bar-num`));

async function until(pred: () => boolean, what: string): Promise<boolean> {
  for (let i = 0; i < 300; i++) {
    if (pred()) return true;
    await tick();
  }
  failures++;
  checks++;
  console.error(`FAIL: не дождались: ${what}`);
  return false;
}

/** Один ход игрока целиком: выбрать заклинание и ответить. */
async function castSpell(env: Env, spellId: string, correct: boolean): Promise<void> {
  if (!(await waitFor(env, "pick", `выбор заклинания ${spellId}`))) return;
  pickSpell(env.root, spellId);
  if (!(await waitFor(env, "question", `вопрос ${spellId}`))) return;
  answer(env.root, correct);
}

async function defend(env: Env, correct: boolean): Promise<void> {
  if (!(await waitFor(env, "question", "защита"))) return;
  answer(env.root, correct);
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------------
  // 1. Подкрался: первый удар за игроком; слабая (тренировочная) ведьма падает с одного удара.
  // ---------------------------------------------------------------------------
  {
    const env = setup();
    const opp = fakeOpponent({ maxPower: TRAINING_WITCH_POWER, playerStrikesFirst: true, openingNote: "Ты подкрался незаметно — первый удар твой!" });
    env.combat.startEncounter(opp);
    check(env.combat.isActive, "бой начался");
    check(await waitFor(env, "pick", "первый ход игрока"), "первым ходит игрок");
    check(text(env.root, ".combat-note").includes("подкрался"), "первое окно сообщает, что игрок бьёт первым");
    check(badge(env.root) === "Твоя атака", "плашка «Твоя атака»");
    check(env.root.querySelectorAll(".battle-bar-line").length === 2, "плашка Сил: две шкалы (ты и противник)");
    check(bar(env.root, "player") === PLAYER_MAX_POWER && bar(env.root, "opponent") === TRAINING_WITCH_POWER, "шкалы полные");
    check(env.stage.events.join() === "begin", "сцена оповещена о начале боя");

    const names = spellOptions(env.root).map((o) => o.querySelector(".bonfire-spell-name")!.textContent);
    check(names.includes(getSpellById("spark").name) && names.includes(getSpellById("flame").name), "в списке изученные заклинания");
    check(optionNamed(env.root, WITCH_SPELL.id) === undefined, "собственной темой ведьмы бить её нельзя");
    check(text(env.root, ".combat-spell-power").includes("100%"), "свежее заклинание бьёт на 100%");

    pickSpell(env.root, "spark");
    check(await waitFor(env, "question", "вопрос атаки"), "после выбора — вопрос");
    check(badge(env.root) === "Твоя атака" && !env.root.querySelector(".combat-note"), "реплика про инициативу — только в первом окне");
    answer(env.root, true);
    check(await waitFor(env, "result", "итог боя"), "после верного удара ведьма без Силы — итог");
    check(text(env.root, ".combat-result-title") === "Победа!" && text(env.root, ".combat-question") === "Победили!", "окно победы с текстом противника");
    check(env.stage.strikes.length === 1 && env.stage.strikes[0].from === "player" && env.stage.strikes[0].result === "hit", "на сцене один удар игрока");
    check(bar(env.root, "opponent") === 0, "у ведьмы Сила кончилась");
    check(env.power.current === PLAYER_MAX_POWER, "игрок не потерял Силу (ведьма не успела ударить)");
    check(env.gs.getMastery("spark") === 1 && env.fatigue.usesInWindow("spark") === 1, "мастерство выросло, применение запомнено");

    proceed(env.root);

    await tick(); // исход боя сообщается через микрозадачи
    check(env.ended.length === 1 && env.ended[0].outcome === "won" && env.ended[0].kind === "witch", "исход «победа» сообщён один раз");
    check(!env.combat.isActive && !env.root.querySelector(".battle-bar") && !env.root.querySelector(".combat-overlay"), "после боя на экране пусто");
    check(env.stage.events.join() === "begin,end", "сцена оповещена о конце боя");
  }

  // ---------------------------------------------------------------------------
  // 2. Ведьма заметила: бьёт первой. Неверная защита отнимает Силу, верная — нет; отступление.
  // ---------------------------------------------------------------------------
  {
    const env = setup();
    env.combat.startEncounter(fakeOpponent({ maxPower: WITCH_POWER, playerStrikesFirst: false, openingNote: "Ведьма заметила тебя — она бьёт первой!" }));

    check(await waitFor(env, "question", "первый ход ведьмы"), "первой ходит ведьма: сразу вопрос защиты");
    check(badge(env.root) === "Атака ведьмы" && text(env.root, ".combat-note").includes("первой"), "плашка «Атака ведьмы» и реплика про инициативу");
    answer(env.root, false);
    check(await until(() => env.stage.strikes.length === 1, "удар ведьмы"), "удар ведьмы показан на сцене");
    check(env.stage.strikes[0].from === "opponent" && env.stage.strikes[0].result === "hit" && env.stage.strikes[0].spell === WITCH_SPELL.id, "ведьма попала своим заклинанием");
    check(await waitFor(env, "pick", "ход игрока после удара"), "после удара ходит игрок");
    check(env.power.current === PLAYER_MAX_POWER - WITCH_HIT_DAMAGE && bar(env.root, "player") === PLAYER_MAX_POWER - WITCH_HIT_DAMAGE, "неверная защита отняла Силу (и шкала на экране обновилась)");

    pickSpell(env.root, "spark");
    await waitFor(env, "question", "атака");
    answer(env.root, false);
    check(await waitFor(env, "question", "защита после промаха"), "после промаха снова ход ведьмы");
    check(env.stage.strikes[1].from === "player" && env.stage.strikes[1].result === "missed", "промах игрока показан как «мимо»");
    check(bar(env.root, "opponent") === WITCH_POWER && env.fatigue.usesInWindow("spark") === 0, "промах: у ведьмы Сила цела, заклинание не устало");

    answer(env.root, true);
    check(await waitFor(env, "pick", "ход игрока после отражения"), "верная защита — ход игрока");
    check(env.stage.strikes[2].from === "opponent" && env.stage.strikes[2].result === "blocked", "отражённый удар");
    check(env.power.current === PLAYER_MAX_POWER - WITCH_HIT_DAMAGE, "отражённый удар Силу не отнимает");

    retreat(env.root);

    await tick(); // исход боя сообщается через микрозадачи
    check(env.ended.length === 1 && env.ended[0].outcome === "retreated", "отступление сообщено");
    check(!env.combat.isActive && !env.root.querySelector(".combat-result-title"), "при отступлении итогового окна нет");
    check(env.power.current === PLAYER_MAX_POWER - WITCH_HIT_DAMAGE, "после отступления Сила игрока не восстанавливается мгновенно (её вернёт время вне боя)");
  }

  // ---------------------------------------------------------------------------
  // 3. Поражение: три неотражённых удара опустошают шкалу игрока.
  // ---------------------------------------------------------------------------
  {
    const env = setup();
    env.combat.startEncounter(fakeOpponent({ maxPower: WITCH_POWER, playerStrikesFirst: false }));
    await defend(env, false);
    await castSpell(env, "spark", false);
    await defend(env, false);
    await castSpell(env, "spark", false);
    await defend(env, false);
    check(await waitFor(env, "result", "итог поражения"), "когда Сила игрока кончилась — итог");
    check(text(env.root, ".combat-result-title") === "Поражение" && text(env.root, ".combat-question") === "Проиграли.", "окно поражения");
    check(env.power.isDepleted && bar(env.root, "player") === 0, "шкала игрока пуста");
    check(env.stage.strikes.filter((s) => s.from === "opponent" && s.result === "hit").length === 3, "ровно три попадания ведьмы");
    proceed(env.root);
    await tick(); // исход боя сообщается через микрозадачи
    check(env.ended.length === 1 && env.ended[0].outcome === "lost", "исход «поражение»");
  }

  // ---------------------------------------------------------------------------
  // 4. Усталость заклинания: урон падает при частом применении одного и того же; бонус мастерства растёт.
  // ---------------------------------------------------------------------------
  {
    const env = setup();
    const readings: number[] = [];
    env.stage.afterImpact = (s) => {
      if (s.from === "player") readings.push(bar(env.root, "opponent"));
    };
    const BIG = 400;
    env.combat.startEncounter(fakeOpponent({ kind: "target", maxPower: BIG, attackSpell: null }));

    const shown: number[] = [];
    const flameShown: number[] = [];
    for (let i = 0; i < 6; i++) {
      await waitFor(env, "pick", `ход ${i + 1}`);
      const spark = optionNamed(env.root, "spark")!;
      shown.push(Number(/(\d+)%/.exec(spark.querySelector(".combat-spell-power")!.textContent!)![1]));
      flameShown.push(Number(/(\d+)%/.exec(optionNamed(env.root, "flame")!.querySelector(".combat-spell-power")!.textContent!)![1]));
      if (i === 5) check(spark.querySelector(".combat-spell-power")!.className.includes("spent"), "сильно уставшее заклинание подсвечено как «выдохлось»");
      pickSpell(env.root, "spark");
      await waitFor(env, "question", `вопрос ${i + 1}`);
      answer(env.root, true);
    }
    await waitFor(env, "pick", "после шестого удара");

    // Ожидание по самим формулам: проверяем, что менеджер правильно их применил (мастерство ДО удара, усталость ДО записи).
    const sim = new SpellFatigue();
    let mastery = 0;
    let left = BIG;
    const expected: number[] = [];
    const expectedShown: number[] = [];
    for (let i = 0; i < 6; i++) {
      expectedShown.push(efficiencyPercent(sim.multiplierFor("spark")));
      left -= spellDamage({ mastery, fatigueMultiplier: sim.multiplierFor("spark") });
      expected.push(left);
      sim.record("spark");
      mastery = Math.min(MAX_MASTERY, mastery + 1);
    }
    check(readings.join() === expected.join(), `шкала цели после каждого удара: ${readings.join()} (ожидали ${expected.join()})`);
    check(shown.join() === expectedShown.join(), `«Сила удара» в списке: ${shown.join()} (ожидали ${expectedShown.join()})`);
    check(shown[0] === 100 && shown[5] < shown[0], "урон одним заклинанием падает");
    check(flameShown.every((p) => p === 100), "другое заклинание всё это время в полной силе");

    // Переключились на другое — оно бьёт на полную, а уставшее остаётся уставшим.
    pickSpell(env.root, "flame");
    await waitFor(env, "question", "вопрос flame");
    answer(env.root, true);
    await waitFor(env, "pick", "после flame");
    check(env.fatigue.usesInWindow("flame") === 1, "применение другого заклинания тоже запомнено");
    check(efficiencyLevel(1) === "fresh" && efficiencyLevel(0.8) === "tired" && efficiencyLevel(0.4) === "spent", "уровни усталости для подсветки");
    retreat(env.root);
    await tick(); // исход боя сообщается через микрозадачи
    check(env.ended.length === 1 && env.ended[0].kind === "target", "бой с целью завершён отступлением");
  }

  // ---------------------------------------------------------------------------
  // 5. Тренировочная цель не отвечает ударами: защитных окон нет, Сила игрока не тратится; падает с двух ударов.
  // ---------------------------------------------------------------------------
  {
    const env = setup();
    const badges: string[] = [];
    env.combat.startEncounter(fakeOpponent({ kind: "target", maxPower: PRACTICE_TARGET_POWER, attackSpell: null }));
    for (let i = 0; i < 2; i++) {
      await waitFor(env, "pick", `ход ${i + 1}`);
      badges.push(badge(env.root));
      pickSpell(env.root, "spark");
      await waitFor(env, "question", `вопрос ${i + 1}`);
      badges.push(badge(env.root));
      answer(env.root, true);
    }
    check(await waitFor(env, "result", "цель разбита"), "цель разбита двумя ударами");
    check(badges.every((b) => b === "Твоя атака"), "у цели нет окон защиты — ходит только игрок");
    check(env.stage.strikes.every((s) => s.from === "player"), "на сцене только удары игрока");
    check(env.power.current === PLAYER_MAX_POWER, "тренировка не тратит Силу игрока");
    proceed(env.root);
    await tick(); // исход боя сообщается через микрозадачи
    check(env.ended[0].outcome === "won" && env.ended[0].kind === "target", "победа над целью");

    // Новый бой с той же целью начинается с полной шкалы.
    env.combat.startEncounter(fakeOpponent({ kind: "target", maxPower: PRACTICE_TARGET_POWER, attackSpell: null }));
    await waitFor(env, "pick", "второй бой");
    check(bar(env.root, "opponent") === PRACTICE_TARGET_POWER, "шкала цели в новом бою снова полная");
    retreat(env.root);
    await tick(); // исход боя сообщается через микрозадачи
  }

  // ---------------------------------------------------------------------------
  // 6. Нет подходящих заклинаний: сообщение и отступление; повторный запуск боя во время боя игнорируется.
  // ---------------------------------------------------------------------------
  {
    const env = setup({ learn: [] });
    env.combat.startEncounter(fakeOpponent({ playerStrikesFirst: true }));
    env.combat.startEncounter(fakeOpponent({ id: "other" }));
    check(env.root.querySelectorAll(".battle-bar").length === 1, "второй вызов startEncounter во время боя игнорируется");
    await waitFor(env, "pick", "пустой выбор");
    check(spellOptions(env.root).length === 0 && text(env.root, ".combat-question") === "Нечем бить, отступай.", "вместо списка — объяснение");
    retreat(env.root);
    await tick(); // исход боя сообщается через микрозадачи
    check(env.ended.length === 1 && env.ended[0].id === "opp1", "отступили из пустого выбора");
  }

  // ---------------------------------------------------------------------------
  // 7. Сбои сцены не ломают бой, а последствия удара применяются ровно один раз.
  // ---------------------------------------------------------------------------
  {
    const realWarn = console.warn;
    const realError = console.error;
    console.warn = () => {};
    console.error = () => {};
    try {
      const scenarios: Array<{ name: string; stage: BattleStage }> = [
        { name: "сцена падает", stage: { begin() {}, end() {}, strike: () => Promise.reject(new Error("сбой 3D")) } },
        { name: "сцена не сообщает о попадании", stage: { begin() {}, end() {}, strike: () => Promise.resolve() } },
        { name: "сцена сообщает о попадании дважды", stage: { begin() {}, end() {}, strike: (s) => (s.onImpact?.(), s.onImpact?.(), Promise.resolve()) } },
      ];
      for (const sc of scenarios) {
        const env = setup({ stage: sc.stage });
        env.combat.startEncounter(fakeOpponent({ maxPower: WITCH_POWER }));
        await castSpell(env, "spark", true);
        await defend(env, true); // ответный ход ведьмы: отражаем и возвращаемся к выбору заклинания
        await waitFor(env, "pick", sc.name);
        const dealt = WITCH_POWER - bar(env.root, "opponent");
        check(dealt === spellDamage({ mastery: 0, fatigueMultiplier: 1 }), `${sc.name}: урон применился ровно один раз (${dealt})`);
        retreat(env.root);
        await tick(); // исход боя сообщается через микрозадачи
        check(!env.combat.isActive, `${sc.name}: бой завершается штатно`);
      }

      // Ошибка данных (у заклинания ведьмы нет банка вопросов защиты): игрока не запираем в бою.
      const env = setup();
      const brokenSpell = { ...WITCH_SPELL, banks: {} };
      env.combat.startEncounter(fakeOpponent({ playerStrikesFirst: false, attackSpell: brokenSpell }));
      await until(() => env.ended.length === 1, "аварийное завершение боя");
      check(env.ended[0].outcome === "retreated" && !env.combat.isActive, "ошибка в данных = отступление, бой не зависает");
      check(!env.root.querySelector(".battle-bar") && !env.root.querySelector(".combat-overlay"), "после аварийного завершения экран чист");

    } finally {
      console.warn = realWarn;
      console.error = realError;
    }
  }

  // ---------------------------------------------------------------------------
  // 8. Бой со сценой по умолчанию (без 3D) тоже работает.
  // ---------------------------------------------------------------------------
  {
    const env = setup({ stage: NULL_BATTLE_STAGE });
    env.combat.startEncounter(fakeOpponent({ maxPower: TRAINING_WITCH_POWER }));
    await castSpell(env, "flame", true);
    check(await waitFor(env, "result", "итог без сцены"), "без 3D-сцены бой доходит до победы");
    proceed(env.root);
    await tick(); // исход боя сообщается через микрозадачи
  }

  // ---------------------------------------------------------------------------
  // 9. Фабрика противников: сила, инициатива, цели.
  // ---------------------------------------------------------------------------
  {
    let power = 90;
    const factory = createOpponentFactory(() => power);
    const mkWitch = (over: { friendly?: boolean; spotted?: boolean }) =>
      ({ id: "w", friendly: over.friendly ?? false, hasSpottedPlayer: over.spotted ?? false, spell: WITCH_SPELL, root: {} }) as never;

    const unaware = factory.witch(mkWitch({ spotted: false }));
    check(unaware.playerStrikesFirst && unaware.openingNote !== null && unaware.openingNote.includes("подкрался"), "ведьма не видела игрока — первый удар его");
    const aware = factory.witch(mkWitch({ spotted: true }));
    check(!aware.playerStrikesFirst && aware.openingNote !== null && aware.openingNote.includes("первой"), "ведьма видела игрока — она бьёт первой");
    const friendly = factory.witch(mkWitch({ friendly: true, spotted: false }));
    check(friendly.playerStrikesFirst && friendly.openingNote === null, "спарринг с дружелюбной: начинает игрок, без реплики");
    check(unaware.kind === "witch" && unaware.attackSpell === WITCH_SPELL && unaware.playerAttackRole === "attackWitch", "ведьма бьёт своей темой, игрок атакует из боевого банка");
    check(unaware.maxPower === 90, "сила ведьмы берётся из правил");
    power = 30;
    check(factory.witch(mkWitch({})).maxPower === 30, "сила спрашивается заново в момент встречи");

    const target = factory.target({ id: "t", kind: "dummy", root: {} } as never);
    check(target.kind === "target" && target.title === "Чучело" && target.attackSpell === null && target.playerStrikesFirst, "чучело: не бьёт в ответ, игрок начинает");
    check(target.playerAttackRole === "staticTarget" && target.maxPower === PRACTICE_TARGET_POWER, "цель: банк тренировки и своя сила");
    check(factory.target({ id: "t2", kind: "tree", root: {} } as never).title === "Деревце" && factory.target({ id: "t3", kind: "nettle", root: {} } as never).title === "Крапива", "названия других целей");

    check(witchPowerFor(0) === TRAINING_WITCH_POWER && witchPowerFor(1) === WITCH_POWER && witchPowerFor(-1) === WITCH_POWER && witchPowerFor(99) === WITCH_POWER, "сила ведьмы по секциям: первая тренировочная");
  }

  // ---------------------------------------------------------------------------
  // 10. HUD показывает шкалу Силы игрока и следует за ней.
  // ---------------------------------------------------------------------------
  {
    const root = freshRoot();
    const hud = new Hud(root);
    const pool = new PowerPool(100);
    const off = hud.bindPower(pool);
    const fill = root.querySelector(".hud-bar-fill") as HTMLElement;
    check(text(root, ".hud-bar-label") === "Сила" && fill.style.width === "100.0%", "HUD: подпись «Сила» и полная шкала");
    pool.drain(40);
    check(fill.style.width === "60.0%", `HUD следует за шкалой (${fill.style.width})`);
    off();
    pool.drain(10);
    check(fill.style.width === "60.0%", "после отписки HUD не обновляется");
  }

  if (failures === 0) {
    console.log(`OK: бой на шкалах Силы — ${checks} проверок (ходы и инициатива, Сила, усталость, цели, сбои сцены)`);
  } else {
    console.error(`FAILED: ${failures} из ${checks}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FAIL: тест упал с исключением:", err);
  process.exit(1);
});
