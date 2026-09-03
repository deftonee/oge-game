import { ALL_SPELLS, Spell, SpellQuestion, schoolOf } from "../data/spells";
import { GameState } from "../core/GameState";
import { appendSolvedButton } from "../debug/debugSolve";

export interface LearningCallbacks {
  onSpellLearned: (spell: Spell) => void;
}

type Stage = "menu" | "simple" | "harder" | "done";

/**
 * Обучение у костра (п.3 ТЗ), в два этапа:
 * 1. Показываем закон физики + формулу, игрок решает простейший пример.
 * 2. Задача посложнее (доп. шаг/конверсия единиц).
 * Ошибки в обучении не наказываются — это тренировка, а не бой: неверный
 * ответ просто просит попробовать снова с тем же примером.
 */
export class LearningManager {
  private overlay: HTMLElement | null = null;

  constructor(private uiRoot: HTMLElement, private gameState: GameState, private callbacks: LearningCallbacks) {}

  public get isActive(): boolean {
    return this.overlay !== null;
  }

  public open(): void {
    if (this.isActive) return;
    this.renderMenu();
  }

  public close(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  private unlockableSpells(): Spell[] {
    return ALL_SPELLS.filter((s) => this.gameState.isUnlockable(s));
  }

  private renderMenu(): void {
    this.teardown();

    const overlay = document.createElement("div");
    overlay.className = "bonfire-overlay";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) this.close();
    });

    const panel = document.createElement("div");
    panel.className = "bonfire-panel";

    const header = document.createElement("div");
    header.className = "bonfire-header";
    header.innerHTML = `<div class="bonfire-title">🔥 Костёр</div>`;
    const closeBtn = document.createElement("button");
    closeBtn.className = "graph-close";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => this.close());
    header.appendChild(closeBtn);
    panel.appendChild(header);

    const options = this.unlockableSpells();

    if (options.length === 0) {
      const empty = document.createElement("div");
      empty.className = "bonfire-empty";
      empty.textContent = "Пока нечего изучать здесь — новые темы откроются, когда ты выучишь их пререквизиты.";
      panel.appendChild(empty);
    } else {
      const intro = document.createElement("div");
      intro.className = "bonfire-intro";
      intro.textContent = "Выбери, какое заклинание изучить:";
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
        item.addEventListener("click", () => this.renderStage(spell, "simple"));
        list.appendChild(item);
      }
      panel.appendChild(list);
    }

    overlay.appendChild(panel);
    this.uiRoot.appendChild(overlay);
    this.overlay = overlay;
  }

  private renderStage(spell: Spell, stage: Exclude<Stage, "menu" | "done">): void {
    this.teardown();

    const question: SpellQuestion = stage === "simple" ? spell.tutorial.simple : spell.tutorial.harder;

    const overlay = document.createElement("div");
    overlay.className = "bonfire-overlay";

    const panel = document.createElement("div");
    panel.className = "bonfire-panel";

    const header = document.createElement("div");
    header.className = "bonfire-header";
    header.innerHTML = `<div class="bonfire-title">🔥 ${spell.name}</div>`;
    panel.appendChild(header);

    const stageLabel = document.createElement("div");
    stageLabel.className = "bonfire-stage-label";
    stageLabel.textContent = stage === "simple" ? "Этап 1 из 2 · Разбор закона" : "Этап 2 из 2 · Задача посложнее";
    panel.appendChild(stageLabel);

    if (stage === "simple") {
      const theory = document.createElement("div");
      theory.className = "bonfire-theory";
      theory.innerHTML = `
        <div class="bonfire-law">${spell.law}</div>
        <div class="bonfire-formula">${spell.formula}</div>
      `;
      panel.appendChild(theory);
    }

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
    submit.textContent = stage === "simple" ? "Проверить" : "Завершить изучение";
    panel.appendChild(submit);

    const submitAnswer = () => {
      const value = parseFloat(input.value.replace(",", "."));
      if (Number.isNaN(value)) {
        feedback.textContent = "Введи число.";
        feedback.className = "combat-feedback fail";
        return;
      }

      const correct = Math.abs(value - question.answer) <= question.tolerance;

      if (correct) {
        feedback.textContent = "Верно!";
        feedback.className = "combat-feedback ok";
        setTimeout(() => {
          if (stage === "simple") {
            this.renderStage(spell, "harder");
          } else {
            this.gameState.learn(spell.id);
            this.renderSuccess(spell);
            this.callbacks.onSpellLearned(spell);
          }
        }, 400);
      } else {
        feedback.textContent = "Не совсем — попробуй ещё раз, подставь числа в формулу заново.";
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
    appendSolvedButton(panel, input, question.answer, submitAnswer);

    overlay.appendChild(panel);
    this.uiRoot.appendChild(overlay);
    this.overlay = overlay;
    input.focus();
  }

  private renderSuccess(spell: Spell): void {
    this.teardown();

    const overlay = document.createElement("div");
    overlay.className = "bonfire-overlay";

    const panel = document.createElement("div");
    panel.className = "bonfire-panel";
    panel.innerHTML = `
      <div class="bonfire-success-title" style="color:${spell.color}">Заклинание изучено!</div>
      <div class="bonfire-spell-name" style="color:${spell.color}">${spell.name}</div>
      <div class="bonfire-spell-law">${spell.law}</div>
      <div class="bonfire-formula">${spell.formula}</div>
    `;

    const continueBtn = document.createElement("button");
    continueBtn.className = "combat-submit";
    continueBtn.textContent = "Изучить ещё / выйти";
    continueBtn.addEventListener("click", () => this.renderMenu());
    panel.appendChild(continueBtn);

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
