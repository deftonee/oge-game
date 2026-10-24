import { questionsFor } from "../data/spells";
import type { QuestionRole, Spell, SpellQuestion } from "../data/spells";

/** Допустимое отклонение ответа игрока от верного. */
export function isAnswerCorrect(question: SpellQuestion, value: number): boolean {
  return Math.abs(value - question.answer) <= question.tolerance;
}

/**
 * Выбор вопроса для заклинания и роли без повторов, пока в банке есть невыпадавшие
 * (когда банк исчерпан — идём по кругу). Один экземпляр на один бой.
 */
export class QuestionPicker {
  private readonly asked = new Map<string, Set<string>>();

  constructor(private readonly random: () => number = Math.random) {}

  public pick(spell: Spell, role: QuestionRole): SpellQuestion {
    const bank = questionsFor(spell, role);
    if (bank.length === 0) {
      throw new Error(`[combat] «${spell.id}» не имеет вопросов для роли ${role}`);
    }
    const key = `${spell.id}:${role}`;
    let seen = this.asked.get(key);
    if (!seen) {
      seen = new Set();
      this.asked.set(key, seen);
    }
    const fresh = bank.filter((q) => !seen!.has(q.id));
    const source = fresh.length > 0 ? fresh : bank;
    const question = source[Math.min(source.length - 1, Math.floor(this.random() * source.length))];
    seen.add(question.id);
    return question;
  }
}
