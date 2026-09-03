import { Spell, SpellQuestion, hasQuestionRole, questionsFor, schoolOf } from "../data/spells";
import { GameState } from "../core/GameState";
import { EnergyGate } from "../entities/EnergyGate";

export interface GateCallbacks {
  onGateOpened: (gate: EnergyGate) => void;
}

/**
 * Энергетический барьер между секциями (по фидбэку): нужно заклинание, чтобы
 * пробить. Уровень барьера — требуемое СУММАРНОЕ число изученных тем: ветки
 * независимы, глубина одной школы не форсируется. Барьер — статическая цель,
 * вопросы берутся из банка staticTarget. Неверный ответ не наказывает —
 * барьер просто не поддался, пробуй снова (это проверка знаний, а не бой).
 */
export class GateManager {
  private overlay: HTMLElement | null = null;
  private askedIds = new Set<string>();

  constructor(private uiRoot: HTMLElement, private gameState: GameState, private callbacks: GateCallbacks) {}

  public get isActive(): boolean {
    return this.overlay !== null;
  }

  public open(gate: EnergyGate): void {
    if (this.isActive) return;
    this.askedIds.clear();
    this.renderPickSpell(gate);
  }

  public close(): void {
    this.teardown();
  }

  private eligibleSpells(gate: EnergyGate): Spell[] {
    // Барьер — статическая цель: применимы темы с банком тренировки.
    return this.gameState.getLearnedSpells().filter((s) => hasQuestionRole(s, "staticTarget"));
  }

  private pickQuestion(spell: Spell): SpellQuestion {
    const bank = questionsFor(spell, "staticTarget");
    const pool = bank.filter((q) => !this.askedIds.has(q.id));
    const source = pool.length > 0 ? pool : bank;
    const question = source[Math.floor(Math.random() * source.length)];
    this.askedIds.add(question.id);
    return question;
  }

  private renderPickSpell(gate: EnergyGate): void {
    this.teardown();
    const options = this.eligibleSpells(gate);

    const overlay = document.createElement("div");
    overlay.className = "gate-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.close();
    });

    const panel = document.createElement("div");
    panel.className = "bonfire-panel gate-panel";

    const header = document.createElement("div");
    header.className = "bonfire-header";
    header.innerHTML = `<div class="bonfire-title gate-title">⚡ Энергетический барьер · ${gate.requiredSpells} изученных тем</div>`;
    const closeBtn = document.createElement("button");
    closeBtn.className = "graph-close";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => this.close());
    header.appendChild(closeBtn);
    panel.appendChild(header);

    if (options.length === 0) {
      const empty = document.createElement("div");
      empty.className = "bonfire-empty";
      empty.textContent = `Нужно изучить хотя бы ${gate.requiredSpells} тем — пока нечего применить. Вернись к костру.`;
      panel.appendChild(empty);
    } else {
      const intro = document.createElement("div");
      intro.className = "bonfire-intro";
      intro.textContent = "Выбери заклинание, чтобы пробить барьер:";
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
          <div class="bonfire-spell-school">${schoolOf(spell).icon} ${schoolOf(spell).pathName}</div>
          <div class="bonfire-spell-formula">${spell.formula}</div>
        `;
        item.addEventListener("click", () => this.renderQuestion(gate, spell));
        list.appendChild(item);
      }
      panel.appendChild(list);
    }

    overlay.appendChild(panel);
    this.uiRoot.appendChild(overlay);
    this.overlay = overlay;
  }

  private renderQuestion(gate: EnergyGate, spell: Spell): void {
    this.teardown();
    const question = this.pickQuestion(spell);

    const overlay = document.createElement("div");
    overlay.className = "gate-overlay";

    const panel = document.createElement("div");
    panel.className = "bonfire-panel gate-panel";
    panel.innerHTML = `<div class="bonfire-header"><div class="bonfire-title gate-title" style="color:${spell.color}">⚡ ${spell.name}</div></div>`;

    const formula = document.createElement("div");
    formula.className = "bonfire-formula";
    formula.textContent = spell.formula;
    panel.appendChild(formula);

    const questionEl = document.createElement("div");
    questionEl.className = "combat-question";
    questionEl.textContent = question.text;
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
    unit.textContent = question.unit;
    answerRow.appendChild(unit);
    panel.appendChild(answerRow);

    const feedback = document.createElement("div");
    feedback.className = "combat-feedback";
    panel.appendChild(feedback);

    const submit = document.createElement("button");
    submit.className = "combat-submit";
    submit.textContent = "Пробить барьер";
    panel.appendChild(submit);

    const back = document.createElement("button");
    back.className = "combat-retreat";
    back.textContent = "Назад к выбору";
    back.addEventListener("click", () => this.renderPickSpell(gate));
    panel.appendChild(back);

    const submitAnswer = () => {
      const value = parseFloat(input.value.replace(",", "."));
      if (Number.isNaN(value)) {
        feedback.textContent = "Введи число.";
        feedback.className = "combat-feedback fail";
        return;
      }
      const correct = Math.abs(value - question.answer) <= question.tolerance;
      if (correct) {
        this.gameState.addMastery(spell.id, 1);
        this.gameState.openGate(gate.id);
        gate.open();
        feedback.textContent = "Барьер разрушен!";
        feedback.className = "combat-feedback ok";
        submit.disabled = true;
        setTimeout(() => {
          this.teardown();
          this.callbacks.onGateOpened(gate);
        }, 500);
      } else {
        feedback.textContent = "Барьер не поддался — попробуй ещё раз.";
        feedback.className = "combat-feedback fail";
        panel.classList.remove("shake");
        void panel.offsetWidth;
        panel.classList.add("shake");
      }
    };

    submit.addEventListener("click", submitAnswer);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitAnswer();
    });

    overlay.appendChild(panel);
    this.uiRoot.appendChild(overlay);
    this.overlay = overlay;
    input.focus();
  }

  private teardown(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}
