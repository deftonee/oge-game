import { Spell, SpellQuestion, hasQuestionRole, questionsFor, schoolOf } from "../data/spells";
import { GameState } from "../core/GameState";
import { appendSolvedButton } from "../debug/debugSolve";

/**
 * Тренировка у статического объекта (дерево/чучело/крапива, по фидбэку):
 * выбрал изученное заклинание → один вопрос из боевого банка → фидбэк.
 * Без ставок — неверный ответ ничего не отнимает, верный чуть поднимает
 * мастерство (как лишний повод пользоваться механикой, а не только боем).
 */
export class PracticeManager {
  private overlay: HTMLElement | null = null;
  private askedIds = new Map<string, Set<string>>();

  constructor(private uiRoot: HTMLElement, private gameState: GameState) {}

  public get isActive(): boolean {
    return this.overlay !== null;
  }

  public open(): void {
    if (this.isActive) return;
    this.renderMenu();
  }

  public close(): void {
    this.teardown();
  }

  private pickQuestion(spell: Spell): SpellQuestion {
    let asked = this.askedIds.get(spell.id);
    if (!asked) {
      asked = new Set();
      this.askedIds.set(spell.id, asked);
    }
    // Тренировка у статической цели — только банк роли staticTarget.
    const bank = questionsFor(spell, "staticTarget");
    const pool = bank.filter((q) => !asked!.has(q.id));
    const source = pool.length > 0 ? pool : bank;
    const question = source[Math.floor(Math.random() * source.length)];
    asked.add(question.id);
    return question;
  }

  private renderMenu(): void {
    this.teardown();
    // Только темы с банком тренировки (staticTarget) можно отрабатывать у цели.
    const options = this.gameState.getLearnedSpells().filter((s) => hasQuestionRole(s, "staticTarget"));

    const overlay = document.createElement("div");
    overlay.className = "bonfire-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.close();
    });

    const panel = document.createElement("div");
    panel.className = "bonfire-panel";

    const header = document.createElement("div");
    header.className = "bonfire-header";
    header.innerHTML = `<div class="bonfire-title">🎯 Тренировка</div>`;
    const closeBtn = document.createElement("button");
    closeBtn.className = "graph-close";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => this.close());
    header.appendChild(closeBtn);
    panel.appendChild(header);

    if (options.length === 0) {
      const empty = document.createElement("div");
      empty.className = "bonfire-empty";
      empty.textContent = "Ты пока не знаешь ни одного заклинания — сначала загляни к костру.";
      panel.appendChild(empty);
    } else {
      const intro = document.createElement("div");
      intro.className = "bonfire-intro";
      intro.textContent = "Потренируй заклинание — ошибка ничего не стоит:";
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
        item.addEventListener("click", () => this.renderQuestion(spell));
        list.appendChild(item);
      }
      panel.appendChild(list);
    }

    overlay.appendChild(panel);
    this.uiRoot.appendChild(overlay);
    this.overlay = overlay;
  }

  private renderQuestion(spell: Spell): void {
    this.teardown();
    const question = this.pickQuestion(spell);

    const overlay = document.createElement("div");
    overlay.className = "bonfire-overlay";

    const panel = document.createElement("div");
    panel.className = "bonfire-panel";
    panel.innerHTML = `<div class="bonfire-header"><div class="bonfire-title" style="color:${spell.color}">🎯 ${spell.name}</div></div>`;

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
    submit.textContent = "Проверить";
    panel.appendChild(submit);

    const again = document.createElement("button");
    again.className = "combat-retreat";
    again.textContent = "Назад к выбору";
    again.addEventListener("click", () => this.renderMenu());
    panel.appendChild(again);

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
        feedback.textContent = "Точно! Мастерство растёт.";
        feedback.className = "combat-feedback ok";
      } else {
        feedback.textContent = `Мимо. Правильный ответ: ${question.answer} ${question.unit}`;
        feedback.className = "combat-feedback fail";
      }
      setTimeout(() => this.renderQuestion(spell), 900);
    };

    submit.addEventListener("click", submitAnswer);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitAnswer();
    });
    appendSolvedButton(panel, input, question.answer, submitAnswer);

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
