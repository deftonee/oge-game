/**
 * Шкала Силы — общая для всех, кто участвует в бою: игрок, ведьма, чучело и
 * любой другой предмет, с которым можно сразиться. Бой идёт, пока ни у кого
 * шкала не опустела.
 *
 * Класс ничего не знает ни про сцену, ни про DOM: HUD и окно боя подписываются
 * на изменения через subscribe().
 */
export type PowerListener = () => void;

export class PowerPool {
  private value: number;
  private readonly listeners = new Set<PowerListener>();

  constructor(
    public readonly max: number,
    initial: number = max
  ) {
    if (!Number.isFinite(max) || max <= 0) throw new RangeError(`[power] max должен быть > 0, получил ${max}`);
    this.value = this.clamp(initial);
  }

  /** Сколько Силы осталось (может быть дробным: восстановление идёт по кадрам). */
  public get current(): number {
    return this.value;
  }

  /** Доля от максимума, 0…1. */
  public get fraction(): number {
    return this.value / this.max;
  }

  public get isDepleted(): boolean {
    return this.value <= 0;
  }

  public get isFull(): boolean {
    return this.value >= this.max;
  }

  /** Отнять Силу. Возвращает, сколько реально снято (не больше остатка). Мусор и отрицательные значения — 0. */
  public drain(amount: number): number {
    if (!(amount > 0)) return 0;
    const taken = Math.min(amount, this.value);
    if (taken > 0) this.set(this.value - taken);
    return taken;
  }

  /** Прибавить Силу (до максимума). Мусор и отрицательные значения игнорируются. */
  public recover(amount: number): void {
    if (!(amount > 0) || this.isFull) return;
    this.set(this.value + amount);
  }

  /** Наполнить шкалу целиком. */
  public restore(): void {
    this.set(this.max);
  }

  /** Подписка на любое изменение значения. Возвращает функцию отписки. */
  public subscribe(listener: PowerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: number): void {
    const clamped = this.clamp(next);
    if (clamped === this.value) return;
    this.value = clamped;
    for (const listener of [...this.listeners]) listener();
  }

  private clamp(v: number): number {
    return Math.max(0, Math.min(this.max, Number.isFinite(v) ? v : 0));
  }
}
