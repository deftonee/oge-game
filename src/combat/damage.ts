import { MASTERY_DAMAGE_BONUS, SPELL_BASE_DAMAGE } from "./combatBalance";

export interface SpellDamageInput {
  /** Мастерство заклинания (0…MAX_MASTERY). */
  mastery: number;
  /** Множитель усталости заклинания (см. SpellFatigue.multiplierFor). */
  fatigueMultiplier: number;
}

/** Урон верно произнесённого заклинания: база × (1 + бонус мастерства) × усталость, целое, не меньше 1. */
export function spellDamage({ mastery, fatigueMultiplier }: SpellDamageInput): number {
  const bonus = 1 + MASTERY_DAMAGE_BONUS * Math.max(0, mastery);
  return Math.max(1, Math.round(SPELL_BASE_DAMAGE * bonus * fatigueMultiplier));
}
