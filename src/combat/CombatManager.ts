import { hasQuestionRole } from "../data/spells";
import type { GameState } from "../core/GameState";
import { BattleBar } from "./BattleBar";
import { NULL_BATTLE_STAGE } from "./BattleStage";
import type { BattleStage, Strike } from "./BattleStage";
import { CombatView, RETREAT } from "./CombatView";
import type { PanelHeader } from "./CombatView";
import { PowerPool } from "./PowerPool";
import { QuestionPicker, isAnswerCorrect } from "./QuestionPicker";
import type { SpellFatigue } from "./SpellFatigue";
import { WITCH_HIT_DAMAGE } from "./combatBalance";
import { spellDamage } from "./damage";
import type { BattleOpponent, BattleOutcome } from "./opponent";

export interface CombatCallbacks {
  /** Бой закончился (победа, поражение или отступление): применить последствия к миру. */
  onBattleEnd: (opponent: BattleOpponent, outcome: BattleOutcome) => void;
}

/** Паузы, чтобы игрок успел прочитать результат ответа (в тестах обнуляются). */
export interface CombatTiming {
  feedbackOkMs: number;
  feedbackFailMs: number;
}

export const DEFAULT_COMBAT_TIMING: CombatTiming = { feedbackOkMs: 600, feedbackFailMs: 1400 };

export interface CombatDeps {
  gameState: GameState;
  /** Шкала Силы игрока — общая с HUD; восстанавливается вне боя. */
  playerPower: PowerPool;
  /** Память об усталости заклинаний — общая для всех боёв и тренировок. */
  fatigue: SpellFatigue;
  /** 3D-сцена боя (анимации и камера). Без неё бой идёт «в окне», как в тестах. */
  stage?: BattleStage;
  timing?: Partial<CombatTiming>;
  /** Источник случайности для выбора вопросов. */
  random?: () => number;
}

type Side = "player" | "opponent";
type TurnResult = "done" | "retreat";

interface Battle {
  readonly opponent: BattleOpponent;
  /** Шкала Силы противника: новая на каждый бой. */
  readonly power: PowerPool;
  readonly questions: QuestionPicker;
  readonly bar: BattleBar;
}

/**
 * Пошаговый бой на шкалах Силы. Противник — ведьма, чучело или любой другой
 * BattleOpponent. Ходы чередуются, пока у кого-то Сила не кончится:
 *  - ход противника (если он умеет бить): игрок решает задачу, чтобы ОТРАЗИТЬ удар; ошибся — теряет Силу;
 *  - ход игрока: выбирает заклинание (тема самого противника на него не действует), решает задачу;
 *    верно — противник теряет Силу (урон зависит от мастерства и усталости заклинания).
 * Кто ходит первым, решает противник (см. opponent.ts): ведьма, заметившая игрока, бьёт первой,
 * а подкравшемуся игроку первый удар принадлежит ему.
 * Состояние боя живёт в одном замкнутом цикле fight(): без «пружины» из таймеров и колбэков.
 */
export class CombatManager {
  private readonly view: CombatView;
  private readonly gameState: GameState;
  private readonly playerPower: PowerPool;
  private readonly fatigue: SpellFatigue;
  private readonly stage: BattleStage;
  private readonly timing: CombatTiming;
  private readonly random: () => number;
  private battle: Battle | null = null;

  constructor(
    private readonly uiRoot: HTMLElement,
    deps: CombatDeps,
    private readonly callbacks: CombatCallbacks
  ) {
    this.gameState = deps.gameState;
    this.playerPower = deps.playerPower;
    this.fatigue = deps.fatigue;
    this.stage = deps.stage ?? NULL_BATTLE_STAGE;
    this.timing = { ...DEFAULT_COMBAT_TIMING, ...deps.timing };
    this.random = deps.random ?? Math.random;
    this.view = new CombatView(uiRoot);
  }

  public get isActive(): boolean {
    return this.battle !== null;
  }

  public startEncounter(opponent: BattleOpponent): void {
    if (this.battle) return;
    const power = new PowerPool(opponent.maxPower);
    const battle: Battle = {
      opponent,
      power,
      questions: new QuestionPicker(this.random),
      bar: new BattleBar(this.uiRoot, opponent.title, this.playerPower, power),
    };
    this.battle = battle;
    this.stage.begin(opponent);
    void this.run(battle);
  }

  // ---------- Ход боя ----------

  private async run(battle: Battle): Promise<void> {
    let outcome: BattleOutcome = "retreated";
    try {
      outcome = await this.fight(battle);
      this.announce(outcome);
      if (outcome !== "retreated") {
        await this.view.showResult(outcome === "won", battle.opponent.messages[outcome]);
      }
    } catch (err) {
      // Сбой в UI/3D не должен намертво запереть игрока в бою: считаем это отступлением.
      // eslint-disable-next-line no-console
      console.error("[combat] бой прерван из-за ошибки:", err);
      outcome = "retreated";
    }
    this.conclude(battle, outcome);
  }

  private async fight(battle: Battle): Promise<BattleOutcome> {
    const { opponent } = battle;
    let side: Side = opponent.playerStrikesFirst || !opponent.attackSpell ? "player" : "opponent";
    let note = opponent.openingNote;

    for (;;) {
      if (battle.power.isDepleted) return "won";
      if (this.playerPower.isDepleted) return "lost";

      const result = side === "player" ? await this.playerTurn(battle, note) : await this.opponentTurn(battle, note);
      note = null;
      if (result === "retreat") return "retreated";

      side = side === "player" && opponent.attackSpell ? "opponent" : "player";
    }
  }

  /** Ход противника: игрок отражает удар задачей на тему противника. */
  private async opponentTurn(battle: Battle, note: string | null): Promise<TurnResult> {
    const { opponent } = battle;
    const spell = opponent.attackSpell!; // fight() даёт ход противнику только если есть чем бить
    const question = battle.questions.pick(spell, "defendWitch");

    const value = await this.view.ask({
      header: this.header(battle, opponent.messages.attackBadge, "witch", note),
      spellName: spell.law,
      formula: spell.formula,
      question,
      accentColor: spell.color,
      submitLabel: "Отразить",
    });

    const blocked = isAnswerCorrect(question, value);
    if (blocked) {
      this.view.setFeedback("Отражено!", "ok");
    } else {
      this.view.setFeedback(`Удар прошёл! Правильный ответ: ${question.answer} ${question.unit}`, "fail");
      this.view.shake();
    }
    await this.wait(blocked ? this.timing.feedbackOkMs : this.timing.feedbackFailMs);

    await this.playStrike({
      from: "opponent",
      spell,
      result: blocked ? "blocked" : "hit",
      onImpact: blocked ? undefined : () => void this.playerPower.drain(WITCH_HIT_DAMAGE),
    });
    return "done";
  }

  /** Ход игрока: выбор заклинания, задача, удар. */
  private async playerTurn(battle: Battle, note: string | null): Promise<TurnResult> {
    const { opponent } = battle;
    // Бить можно только темами с боевым банком (для этого противника), кроме его собственной.
    const options = this.gameState
      .getLearnedSpells(opponent.attackSpell?.id)
      .filter((s) => hasQuestionRole(s, opponent.playerAttackRole));

    const pick = await this.view.pickSpell({
      header: this.header(battle, "Твоя атака", "player", note),
      choices: options.map((spell) => ({ spell, efficiency: this.fatigue.multiplierFor(spell.id) })),
      emptyMessage: opponent.messages.noSpells,
    });
    if (pick === RETREAT) return "retreat";

    const spell = pick;
    const question = battle.questions.pick(spell, opponent.playerAttackRole);
    const value = await this.view.ask({
      header: this.header(battle, "Твоя атака", "player", null),
      spellName: spell.name,
      formula: spell.formula,
      question,
      accentColor: spell.color,
      submitLabel: "Произнести заклинание",
    });

    const hit = isAnswerCorrect(question, value);
    let damage = 0;
    if (hit) {
      // Урон считаем ДО роста мастерства и записи применения: они влияют на следующие удары.
      const efficiency = this.fatigue.multiplierFor(spell.id);
      damage = spellDamage({ mastery: this.gameState.getMastery(spell.id), fatigueMultiplier: efficiency });
      this.view.setFeedback(hitMessage(damage, efficiency), "ok");
      this.fatigue.record(spell.id);
      this.gameState.addMastery(spell.id, 1);
    } else {
      this.view.setFeedback(`Мимо! Правильный ответ: ${question.answer} ${question.unit}`, "fail");
      this.view.shake();
    }
    await this.wait(hit ? this.timing.feedbackOkMs : this.timing.feedbackFailMs);

    await this.playStrike({
      from: "player",
      spell,
      result: hit ? "hit" : "missed",
      onImpact: hit ? () => void battle.power.drain(damage) : undefined,
    });
    return "done";
  }

  /**
   * Прячет окно и показывает удар на сцене. Последствия (onImpact) применяются ровно один раз
   * в любом случае: даже если сцена упала или забыла сообщить о попадании.
   */
  private async playStrike(strike: Strike): Promise<void> {
    this.view.hideForStrike();
    let impacted = false;
    const impact = (): void => {
      if (impacted) return;
      impacted = true;
      strike.onImpact?.();
    };
    try {
      await this.stage.strike({ ...strike, onImpact: impact });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[combat] анимация удара не удалась:", err);
    }
    impact();
  }

  /** Сообщает сцене исход до окна результата. Сбой сцены бой не ломает. */
  private announce(outcome: BattleOutcome): void {
    try {
      this.stage.outcome?.(outcome);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[combat] сцена не смогла показать исход боя:", err);
    }
  }

  private conclude(battle: Battle, outcome: BattleOutcome): void {
    this.battle = null;
    try {
      this.view.close();
      battle.bar.dispose();
      this.stage.end();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[combat] ошибка при завершении боя:", err);
    }
    this.callbacks.onBattleEnd(battle.opponent, outcome);
  }

  // ---------- Мелочи ----------

  private header(battle: Battle, badge: string, badgeClass: PanelHeader["badgeClass"], note: string | null): PanelHeader {
    return { title: battle.opponent.title, badge, badgeClass, note };
  }

  private wait(ms: number): Promise<void> {
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
  }
}

function hitMessage(damage: number, efficiency: number): string {
  const base = `Точное попадание! −${damage} Силы`;
  if (efficiency >= 0.999) return base;
  return `${base} · заклинание устало (${Math.round(efficiency * 100)}% силы удара), попробуй другое`;
}
