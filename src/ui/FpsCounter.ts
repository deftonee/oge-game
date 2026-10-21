import { el } from "./dom";

const REFRESH_SECONDS = 0.5;

/**
 * Маленький счётчик кадров в углу. Текст обновляется раз в полсекунды (не каждый
 * кадр — иначе сам счётчик нагружал бы слабые устройства), а пока он выключен,
 * ничего не делает.
 */
export class FpsCounter {
  private readonly node: HTMLElement;
  private visible = false;
  private since = REFRESH_SECONDS; // первое обновление — сразу после включения

  constructor(uiRoot: HTMLElement) {
    this.node = el("div", "hud-fps");
    this.node.style.display = "none";
    this.node.setAttribute("aria-hidden", "true");
    uiRoot.appendChild(this.node);
  }

  public get isVisible(): boolean {
    return this.visible;
  }

  public setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.node.style.display = visible ? "block" : "none";
    this.since = REFRESH_SECONDS;
  }

  /** Раз в кадр: fps — текущая частота кадров, dt — секунды с прошлого кадра. */
  public update(fps: number, dt: number): void {
    if (!this.visible) return;
    this.since += dt;
    if (this.since < REFRESH_SECONDS) return;
    this.since = 0;
    this.node.textContent = `${Math.round(fps)} FPS`;
  }

  public dispose(): void {
    this.node.remove();
  }
}
