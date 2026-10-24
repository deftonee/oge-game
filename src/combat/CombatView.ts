import { ALL_SCHOOLS, getSchoolById, schoolOf } from "../data/spells";
import type { Spell, SpellQuestion } from "../data/spells";
import { appendSolvedButton } from "../debug/debugSolve";

/** Верхняя строка окна боя: кто с кем, чей сейчас ход и (в первом окне) реплика про инициативу. */
export interface PanelHeader {
  title: string;
  badge: string;
  badgeClass: "witch" | "player";
  note?: string | null;
}

export interface QuestionPrompt {
  header: PanelHeader;
  spellName: string;
  formula: string;
  question: SpellQuestion;
  accentColor: string;
  submitLabel: string;
}

export interface SpellChoice {
  spell: Spell;
  /** Множитель урона с учётом усталости заклинания (1 — свежее). */
  efficiency: number;
}

export interface SpellPrompt {
  header: PanelHeader;
  choices: SpellChoice[];
  /** Что показать, если выбирать не из чего. */
  emptyMessage: string;
}

export type FeedbackKind = "ok" | "fail";

export const RETREAT = "retreat" as const;
export type SpellPick = Spell | typeof RETREAT;

/** «Свежее / подустало / выдохлось» — по множителю урона (цвет подсказки в списке заклинаний). */
export function efficiencyLevel(efficiency: number): "fresh" | "tired" | "spent" {
  if (efficiency >= 0.999) return "fresh";
  return efficiency >= 0.6 ? "tired" : "spent";
}

export function efficiencyPercent(efficiency: number): number {
  return Math.round(efficiency * 100);
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function parseAnswer(raw: string): number | null {
  const value = parseFloat(raw.replace(",", "."));
  return Number.isNaN(value) ? null : value;
}

/**
 * DOM окна боя: окно вопроса, выбор заклинания, итог. Ничего не знает про правила —
 * только показывает и возвращает выбор/ответ игрока промисом. В каждый момент на экране
 * одно окно: новое заменяет прежнее.
 */
export class CombatView {
  private overlay: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private feedbackEl: HTMLElement | null = null;

  constructor(private readonly uiRoot: HTMLElement) {}

  /** Показать окно вопроса. Промис завершается числом, как только игрок отправил корректный ответ; окно остаётся на экране для фидбэка. */
  public ask(prompt: QuestionPrompt): Promise<number> {
    const panel = this.openPanel(prompt.header);

    const spellName = document.createElement("div");
    spellName.className = "combat-spell-name";
    spellName.style.color = prompt.accentColor;
    spellName.textContent = prompt.spellName;

    const formula = document.createElement("div");
    formula.className = "combat-formula";
    formula.textContent = prompt.formula;

    const questionEl = document.createElement("div");
    questionEl.className = "combat-question";
    questionEl.textContent = prompt.question.text;

    const answerRow = document.createElement("div");
    answerRow.className = "combat-answer-row";
    const input = document.createElement("input");
    input.type = "number";
    input.step = "any";
    input.inputMode = "decimal"; // числовая клавиатура с запятой на мобильных
    input.className = "combat-answer-input";
    input.placeholder = "Ответ";
    const unit = document.createElement("span");
    unit.className = "combat-unit";
    unit.textContent = prompt.question.unit;
    answerRow.append(input, unit);

    const feedback = document.createElement("div");
    feedback.className = "combat-feedback";
    this.feedbackEl = feedback;

    const submit = document.createElement("button");
    submit.className = "combat-submit";
    submit.textContent = prompt.submitLabel;

    panel.append(spellName, formula, questionEl, answerRow, feedback, submit);

    return new Promise<number>((resolve) => {
      let sent = false;
      const send = (): void => {
        if (sent) return;
        const value = parseAnswer(input.value);
        if (value === null) {
          this.setFeedback("Введи число.", "fail");
          return;
        }
        sent = true;
        input.disabled = true;
        submit.disabled = true;
        resolve(value);
      };
      submit.addEventListener("click", send);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") send();
      });
      appendSolvedButton(panel, input, prompt.question.answer, send);
      input.focus();
    });
  }

  /** Окно выбора заклинания: сначала чипы школ, затем заклинания выбранной. Завершается заклинанием или RETREAT. */
  public pickSpell(prompt: SpellPrompt): Promise<SpellPick> {
    const panel = this.openPanel(prompt.header);

    return new Promise<SpellPick>((resolve) => {
      const retreat = document.createElement("button");
      retreat.className = "combat-retreat";
      retreat.textContent = "Отступить";
      retreat.addEventListener("click", () => resolve(RETREAT));

      if (prompt.choices.length === 0) {
        const empty = document.createElement("div");
        empty.className = "combat-question";
        empty.textContent = prompt.emptyMessage;
        panel.append(empty, retreat);
        return;
      }

      const intro = document.createElement("div");
      intro.className = "combat-question";
      intro.textContent = "Выбери ветку, затем заклинание для атаки:";

      // Группировка по школам в порядке ALL_SCHOOLS — на тач-экранах длинный
      // плоский список неудобен, поэтому сначала чипы веток, затем спеллы выбранной.
      const groups = new Map<string, SpellChoice[]>();
      for (const choice of prompt.choices) {
        const bucket = groups.get(choice.spell.school) ?? [];
        bucket.push(choice);
        groups.set(choice.spell.school, bucket);
      }
      const branchIds = ALL_SCHOOLS.map((s) => s.id).filter((id) => groups.has(id));

      const bar = document.createElement("div");
      bar.className = "combat-branch-bar";
      const list = document.createElement("div");
      list.className = "bonfire-list";
      let currentBranch = branchIds[0];

      const markActive = (): void => {
        for (const chip of Array.from(bar.children)) {
          chip.classList.toggle("active", (chip as HTMLElement).dataset.branch === currentBranch);
        }
      };
      const renderList = (): void => {
        list.innerHTML = "";
        for (const choice of groups.get(currentBranch)!) list.appendChild(this.buildSpellOption(choice, resolve));
      };

      for (const id of branchIds) {
        const school = getSchoolById(id);
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "combat-branch-chip";
        chip.dataset.branch = id;
        chip.style.borderColor = school.color;
        chip.innerHTML = `<span class="combat-branch-icon">${school.icon}</span><span>${school.name}</span>`;
        chip.addEventListener("click", () => {
          currentBranch = id;
          markActive();
          renderList();
        });
        bar.appendChild(chip);
      }

      panel.append(intro, bar, list, retreat);
      markActive();
      renderList();
    });
  }

  /** Итоговое окно («Победа!» / «Поражение»). Завершается по кнопке «Продолжить». */
  public showResult(won: boolean, text: string): Promise<void> {
    this.closePanel();
    const overlay = this.createOverlay();
    const panel = document.createElement("div");
    panel.className = "combat-panel combat-result";
    panel.innerHTML = `<div class="combat-result-title ${won ? "win" : "lose"}">${won ? "Победа!" : "Поражение"}</div><div class="combat-question">${escapeHtml(text)}</div>`;

    return new Promise<void>((resolve) => {
      const closeBtn = document.createElement("button");
      closeBtn.className = "combat-submit";
      closeBtn.textContent = "Продолжить";
      closeBtn.addEventListener("click", () => resolve());
      panel.appendChild(closeBtn);
      overlay.appendChild(panel);
      this.uiRoot.appendChild(overlay);
      this.overlay = overlay;
      this.panel = panel;
    });
  }

  public setFeedback(text: string, kind: FeedbackKind): void {
    if (!this.feedbackEl) return;
    this.feedbackEl.textContent = text;
    this.feedbackEl.className = `combat-feedback ${kind}`;
  }

  public shake(): void {
    const panel = this.panel;
    if (!panel) return;
    panel.classList.remove("shake");
    void panel.offsetWidth; // перезапуск CSS-анимации
    panel.classList.add("shake");
  }

  /** Спрятать окно на время анимации удара (3D-сцена должна быть видна). Следующее окно появится как обычно. */
  public hideForStrike(): void {
    this.overlay?.classList.add("combat-overlay--fx");
  }

  public get isShown(): boolean {
    return this.overlay !== null;
  }

  /** Убрать окно с экрана. */
  public close(): void {
    this.closePanel();
  }

  // ---------- Внутреннее ----------

  private openPanel(header: PanelHeader): HTMLElement {
    this.closePanel();
    const overlay = this.createOverlay();
    const panel = document.createElement("div");
    panel.className = "combat-panel";
    panel.appendChild(this.buildHeader(header));
    if (header.note) {
      const note = document.createElement("div");
      note.className = "combat-note";
      note.textContent = header.note;
      panel.appendChild(note);
    }
    overlay.appendChild(panel);
    this.uiRoot.appendChild(overlay);
    this.overlay = overlay;
    this.panel = panel;
    this.feedbackEl = null;
    return panel;
  }

  private createOverlay(): HTMLElement {
    const overlay = document.createElement("div");
    overlay.className = "combat-overlay";
    return overlay;
  }

  private closePanel(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.panel = null;
    this.feedbackEl = null;
  }

  private buildHeader(header: PanelHeader): HTMLElement {
    const el = document.createElement("div");
    el.className = "combat-header";
    el.innerHTML = `
      <span class="combat-enemy-name">${escapeHtml(header.title)}</span>
      <span class="combat-badge ${header.badgeClass}">${escapeHtml(header.badge)}</span>
    `;
    return el;
  }

  private buildSpellOption(choice: SpellChoice, pick: (spell: Spell) => void): HTMLElement {
    const { spell, efficiency } = choice;
    const school = schoolOf(spell);
    const item = document.createElement("button");
    item.type = "button";
    item.className = "bonfire-spell-option";
    item.style.borderColor = spell.color;
    item.innerHTML = `
      <div class="bonfire-spell-name" style="color:${spell.color}">${escapeHtml(spell.name)}</div>
      <div class="bonfire-spell-law">${escapeHtml(spell.law)}</div>
      <div class="bonfire-spell-school">${school.icon} ${escapeHtml(school.pathName)}</div>
      <div class="bonfire-spell-formula">${escapeHtml(spell.formula)}</div>
      <div class="combat-spell-power ${efficiencyLevel(efficiency)}">Сила удара ${efficiencyPercent(efficiency)}%</div>
    `;
    item.addEventListener("click", () => pick(spell));
    return item;
  }
}
