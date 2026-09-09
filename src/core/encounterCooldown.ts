const GLOBAL_ENCOUNTER_COOLDOWN = 1.2; // секунд

/**
 * Кулдауны встреч с ведьмами:
 * - cooldownWitchId — ведьма, с которой только что отступили/проиграли дуэль:
 *   пока игрок стоит рядом, бой с ней повторно не запускается. Храним именно id —
 *   при возврате в выгруженную секцию инстанс ведьмы пересоздаётся заново.
 * - Глобальный кулдаун на ЛЮБУЮ новую встречу сразу после боя — страховка,
 *   чтобы случайно оказавшаяся рядом вторая ведьма не перезапустила бой мгновенно.
 */
export class EncounterCooldown {
  private cooldownWitchId: string | null = null;
  private encounterCooldownUntil = 0;
  public elapsedTime = 0;

  /** Накапливать игровое время (должно зваться каждый кадр из render loop). */
  public tick(dt: number): void {
    this.elapsedTime += dt;
  }

  /**
   * Окончание дуэли. witchId передаётся, когда с конкретной ведьмой разошлись
   * (проиграли/отступили) — на неё вешается персональный кулдаун.
   */
  public notifyDuelEnded(witchId?: string): void {
    if (witchId) this.cooldownWitchId = witchId;
    this.encounterCooldownUntil = this.elapsedTime + GLOBAL_ENCOUNTER_COOLDOWN;
  }

  public isGlobalCooldownActive(): boolean {
    return this.elapsedTime < this.encounterCooldownUntil;
  }

  public getCooldownWitchId(): string | null {
    return this.cooldownWitchId;
  }

  /** Снять персональный кулдаун ведьмы (вызывается, когда игрок от неё отошёл). */
  public clearWitchCooldown(): void {
    this.cooldownWitchId = null;
  }
}
