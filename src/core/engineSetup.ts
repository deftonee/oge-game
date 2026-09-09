import { Engine, Scene, Color4 } from "@babylonjs/core";

export interface EngineSetup {
  engine: Engine;
  scene: Scene;
  /** Принудительная эмуляция мобильного на десктопе (?mobile=1, dev-only). */
  emulateMobile: boolean;
}

/**
 * Инициализация низкоуровневой части движка: Engine, Scene, фон, коллизии,
 * обработчик resize и dev-эмуляция мобильного (?mobile=1, см. skill).
 *
 * Dev-эмуляция: окно CSS-сжимается до 9:16, канвас не пересобирает буфер сам —
 * за ним следит ResizeObserver и зовёт engine.resize(). В проде ветка вырезается.
 */
export function createEngineSetup(canvas: HTMLCanvasElement): EngineSetup {
  const engine = new Engine(canvas, true, { stencil: true }, true);

  const emulateMobile =
    import.meta.env.DEV && new URLSearchParams(window.location.search).has("mobile");
  if (emulateMobile) {
    document.body.classList.add("emulate-mobile");
    new ResizeObserver(() => engine.resize()).observe(canvas);
  }

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.06, 0.07, 0.12, 1);
  scene.collisionsEnabled = true;

  window.addEventListener("resize", () => engine.resize());

  return { engine, scene, emulateMobile };
}
