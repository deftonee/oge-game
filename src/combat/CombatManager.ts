import { Witch } from "../entities/Witch";
import { Spell, SpellQuestion } from "../data/spells";
import { GameState } from "../core/GameState";

export interface CombatCallbacks {
  onDuelWon: (witch: Witch) => void;
  onDuelLost: (witch: Witch) => void;
  onRetreat: (witch: Witch) => void;
  onPlayerDamaged: (amount: number) => void;
}

const ROUNDS_TO_WIN = 3; // столько верных атак нужно игроку, чтобы выиграть дуэль
const ROUNDS_TO_LOSE = 3; // столько ударов ведьмы игрок может пропустить, прежде чем проиграть
const DAMAGE_PER_HIT = 15; // урон по общему HP игрока (HUD) за каждую пропущенную атаку

/**
 * Пошаговая дуэль:
 * 1. Ведьма атакует своей темой — игрок решает задачу, чтобы ОТРАЗИТЬ удар.
 * 2. Игрок атакует — выбирает любое ДРУГОЕ изученное заклинание (тема самой
 *    ведьмы на неё не действует, ей нужно противопоставить что-то ещё) и
 *    решает задачу, чтобы попасть.
 * Раунды повторяются, пока одна из сторон не наберёт нужное число попаданий.
 * Хитпоинтов у ведьмы нет — только победа/поражение дуэли, "смерти" нет.
 */
export class CombatManager {
  private uiRoot: HTMLElement;
  private overlay: HTMLElement | null = null;

  private activeWitch: Witch | null = null;
  private witchScore = 0; // попадания ведьмы по игроку
  private playerScore = 0; // попадания игрока по ведьме

  private askedDefenseIds = new Set<string>();
  private askedAttackIds = new Map<string, Set<string>>(); // spellId -> уже заданные вопросы в этой дуэли

  constructor(uiRoot: HTMLElement, private gameState: GameState, private callbacks: CombatCallbacks) {
    this.uiRoot = uiRoot;
  }

  public get isActive(): boolean {
    return this.overlay !== null;
  }

  public startEncounter(witch: Witch): void {
    if (this.isActive) return;
    this.activeWitch = witch;
    this.witchScore = 0;
    this.playerScore = 0;
    this.askedDefenseIds.clear();
    this.askedAttackIds.clear();
    this.renderWitchAttack();
  }

  private pickQuestion(spell: Spell, askedSet: Set<string>): SpellQuestion {
    const pool = spell.questions.filter((q) => !askedSet.has(q.id));
    const source = pool.length > 0 ? pool : spell.questions;
    const question = source[Math.floor(Math.random() * source.length)];
    askedSet.add(question.id);
    return question;
  }

  private askedSetFor(spellId: string): Set<string> {
    let set = this.askedAttackIds.get(spellId);
    if (!set) {
      set = new Set();
      this.askedAttackIds.set(spellId, set);
    }
    return set;
  }

  // ---------- Фаза 1: атака ведьмы, игрок защищается ----------

  private renderWitchAttack(): void {
    const witch = this.activeWitch!;
    const question = this.pickQuestion(witch.spell, this.askedDefenseIds);

    const { panel, feedback, input, submit } = this.renderQuestionShell({
      badge: "Атака ведьмы",
      badgeClass: "witch",
      title: witch.spell.law,
      formula: witch.spell.formula,
      questionText: question.text,
      unit: question.unit,
      submitLabel: "Отразить",
      accentColor: witch.spell.color,
    });

    const submitAnswer = () => {
      const value = this.parseAnswer(input.value);
      if (value === null) {
        feedback.textContent = "Введи число.";
        feedback.className = "combat-feedback fail";
        return;
      }

      const correct = Math.abs(value - question.answer) <= question.tolerance;

      if (correct) {
        feedback.textContent = "Отражено!";
        feedback.className = "combat-feedback ok";
        setTimeout(() => this.renderPlayerPickSpell(), 500);
      } else {
        this.witchScore += 1;
        feedback.textContent = `Удар прошёл! Правильный ответ: ${question.answer} ${question.unit}`;
        feedback.className = "combat-feedback fail";
        this.shake(panel);
        this.callbacks.onPlayerDamaged(DAMAGE_PER_HIT);

        if (this.witchScore >= ROUNDS_TO_LOSE) {
          setTimeout(() => this.endDuel(false), 700);
        } else {
          setTimeout(() => this.renderPlayerPickSpell(), 700);
        }
      }
    };

    submit.addEventListener("click", submitAnswer);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitAnswer();
    });
    input.focus();
  }

  // ---------- Фаза 2а: игрок выбирает, чем атаковать ----------

  private renderPlayerPickSpell(): void {
    const witch = this.activeWitch!;
    const options = this.gameState.getLearnedSpells(witch.spell.id);

    this.teardown();

    const overlay = document.createElement("div");
    overlay.className = "combat-overlay";

    const panel = document.createElement("div");
    panel.className = "combat-panel";
    panel.appendChild(this.buildHeader(witch, "Твоя атака", "player"));
    panel.appendChild(this.buildScoreRow());

    if (options.length === 0) {
      const empty = document.createElement("div");
      empty.className = "combat-question";
      empty.textContent = `«${witch.spell.name}» на неё саму не действует, а других тем ты пока не знаешь. Отступи и выучи что-то ещё у костра.`;
      panel.appendChild(empty);
      this.appendRetreat(panel);
    } else {
      const intro = document.createElement("div");
      intro.className = "combat-question";
      intro.textContent = "Выбери заклинание для атаки:";
      panel.appendChild(intro);

      const list = document.createElement("div");
      list.className = "bonfire-list";
      for (const spell of options) {
        const item = document.createElement("button");
        item.className = "bonfire-spell-option";
        item.style.borderColor = spell.color;
        item.innerHTML = `
          <div class="bonfire-spell-name" style="color:${spell.color}">${spell.name}</div>
          <div class="bonfire-spell-law">${spell.law}</div>
          <div class="bonfire-spell-formula">${spell.formula}</div>
        `;
        item.addEventListener("click", () => this.renderPlayerAttack(spell));
        list.appendChild(item);
      }
      panel.appendChild(list);
      this.appendRetreat(panel);
    }

    overlay.appendChild(panel);
    this.uiRoot.appendChild(overlay);
    this.overlay = overlay;
  }

  // ---------- Фаза 2б: игрок атакует выбранным заклинанием ----------

  private renderPlayerAttack(spell: Spell): void {
    const question = this.pickQuestion(spell, this.askedSetFor(spell.id));

    const { panel, feedback, input, submit } = this.renderQuestionShell({
      badge: "Твоя атака",
      badgeClass: "player",
      title: spell.name,
      formula: spell.formula,
      questionText: question.text,
      unit: question.unit,
      submitLabel: "Произнести заклинание",
      accentColor: spell.color,
    });

    const submitAnswer = () => {
      const value = this.parseAnswer(input.value);
      if (value === null) {
        feedback.textContent = "Введи число.";
        feedback.className = "combat-feedback fail";
        return;
      }

      const correct = Math.abs(value - question.answer) <= question.tolerance;

      if (correct) {
        this.playerScore += 1;
        feedback.textContent = "Точное попадание!";
        feedback.className = "combat-feedback ok";
        this.gameState.addMastery(spell.id, 1);

        if (this.playerScore >= ROUNDS_TO_WIN) {
          setTimeout(() => this.endDuel(true), 700);
        } else {
          setTimeout(() => this.renderWitchAttack(), 700);
        }
      } else {
        feedback.textContent = `Мимо! Правильный ответ: ${question.answer} ${question.unit}`;
        feedback.className = "combat-feedback fail";
        this.shake(panel);
        setTimeout(() => this.renderWitchAttack(), 900);
      }
    };

    submit.addEventListener("click", submitAnswer);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitAnswer();
    });
    input.focus();
  }

  // ---------- Общие куски интерфейса ----------

  private renderQuestionShell(opts: {
    badge: string;
    badgeClass: "witch" | "player";
    title: string;
    formula: string;
    questionText: string;
    unit: string;
    submitLabel: string;
    accentColor: string;
  }): { panel: HTMLElement; feedback: HTMLElement; input: HTMLInputElement; submit: HTMLButtonElement } {
    const witch = this.activeWitch!;
    this.teardown();

    const overlay = document.createElement("div");
    overlay.className = "combat-overlay";

    const panel = document.createElement("div");
    panel.className = "combat-panel";
    panel.appendChild(this.buildHeader(witch, opts.badge, opts.badgeClass));
    panel.appendChild(this.buildScoreRow());

    const spellName = document.createElement("div");
    spellName.className = "combat-spell-name";
    spellName.style.color = opts.accentColor;
    spellName.textContent = opts.title;
    panel.appendChild(spellName);

    const formula = document.createElement("div");
    formula.className = "combat-formula";
    formula.textContent = opts.formula;
    panel.appendChild(formula);

    const questionEl = document.createElement("div");
    questionEl.className = "combat-question";
    questionEl.textContent = opts.questionText;
    panel.appendChild(questionEl);

    const answerRow = document.createElement("div");
    answerRow.className = "combat-answer-row";

    const input = document.createElement("input");
    input.type = "number";
    input.step = "any";
    input.className = "combat-answer-input";
    input.placeholder = "Ответ";
    answerRow.appendChild(input);

    const unit = document.createElement("span");
    unit.className = "combat-unit";
    unit.textContent = opts.unit;
    answerRow.appendChild(unit);
    panel.appendChild(answerRow);

    const feedback = document.createElement("div");
    feedback.className = "combat-feedback";
    panel.appendChild(feedback);

    const submit = document.createElement("button");
    submit.className = "combat-submit";
    submit.textContent = opts.submitLabel;
    panel.appendChild(submit);

    overlay.appendChild(panel);
    this.uiRoot.appendChild(overlay);
    this.overlay = overlay;

    return { panel, feedback, input, submit };
  }

  private buildHeader(witch: Witch, badge: string, badgeClass: "witch" | "player"): HTMLElement {
    const header = document.createElement("div");
    header.className = "combat-header";
    header.innerHTML = `
      <span class="combat-enemy-name">Ведьма ${escapeHtml(witch.spell.law)}</span>
      <span class="combat-badge ${badgeClass}">${escapeHtml(badge)}</span>
    `;
    return header;
  }

  private buildScoreRow(): HTMLElement {
    const row = document.createElement("div");
    row.className = "combat-score-row";
    row.innerHTML = `
      <span class="combat-score player">Ты: ${this.dots(this.playerScore, ROUNDS_TO_WIN)}</span>
      <span class="combat-score witch">Ведьма: ${this.dots(this.witchScore, ROUNDS_TO_LOSE)}</span>
    `;
    return row;
  }

  private dots(filled: number, total: number): string {
    return "●".repeat(filled) + "○".repeat(Math.max(0, total - filled));
  }

  private appendRetreat(panel: HTMLElement): void {
    const retreat = document.createElement("button");
    retreat.className = "combat-retreat";
    retreat.textContent = "Отступить";
    retreat.addEventListener("click", () => this.retreat());
    panel.appendChild(retreat);
  }

  private parseAnswer(raw: string): number | null {
    const value = parseFloat(raw.replace(",", "."));
    return Number.isNaN(value) ? null : value;
  }

  private shake(panel: HTMLElement): void {
    panel.classList.remove("shake");
    void panel.offsetWidth;
    panel.classList.add("shake");
  }

  /** Выйти из дуэли без результата — можно вернуться позже, ничего не засчитывается. */
  private retreat(): void {
    const witch = this.activeWitch!;
    this.teardown();
    this.activeWitch = null;
    this.callbacks.onRetreat(witch);
  }

  private endDuel(won: boolean): void {
    const witch = this.activeWitch!;
    this.teardown();

    const overlay = document.createElement("div");
    overlay.className = "combat-overlay";
    const panel = document.createElement("div");
    panel.className = "combat-panel combat-result";
    panel.innerHTML = won
      ? `<div class="combat-result-title win">Победа!</div><div class="combat-question">Ведьма повержена — заклинание сработало как надо.</div>`
      : `<div class="combat-result-title lose">Поражение</div><div class="combat-question">Слишком много ударов пропущено. Подтянешь тему — вернёшься и попробуешь снова.</div>`;

    const closeBtn = document.createElement("button");
    closeBtn.className = "combat-submit";
    closeBtn.textContent = "Продолжить";
    closeBtn.addEventListener("click", () => {
      this.teardown();
      this.activeWitch = null;
      if (won) this.callbacks.onDuelWon(witch);
      else this.callbacks.onDuelLost(witch);
    });
    panel.appendChild(closeBtn);

    overlay.appendChild(panel);
    this.uiRoot.appendChild(overlay);
    this.overlay = overlay;
  }

  private teardown(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
