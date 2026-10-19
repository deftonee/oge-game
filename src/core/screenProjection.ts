import { Matrix, Vector3 } from "@babylonjs/core";
import type { Camera, Scene } from "@babylonjs/core";
import type { ScreenPoint } from "../ui/loot/lootTimeline";

/** Прямоугольник холста на странице (CSS px) — как у getBoundingClientRect. */
export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Всё, что проектору нужно знать о движке: размер рендер-буфера (он бывает не равен CSS-размеру). */
export interface RenderSize {
  getRenderWidth(): number;
  getRenderHeight(): number;
}

const IDENTITY = Matrix.Identity();

/** Отступ от края экрана, если точка ушла за пределы (px). */
const EDGE_MARGIN = 24;

/**
 * Проекция мировых точек в координаты страницы (CSS px) — чтобы HTML-эффекты
 * могли стартовать и приземляться ровно у 3D-объектов (сундук, рюкзак).
 * Учитывает hardware scaling движка (рендер-буфер ≠ CSS-размеру холста).
 */
export class ScreenProjector {
  private readonly tmp = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly engine: RenderSize,
    private readonly viewport: () => ViewportRect
  ) {}

  /**
   * Точка экрана для мировой позиции. Если точка за камерой или за дальней
   * плоскостью, возвращается безопасная точка внизу экрана; результат всегда
   * зажат в границы холста с отступом — эффект не улетает «в никуда».
   */
  public pointOf(world: Vector3, out: ScreenPoint = { x: 0, y: 0 }): ScreenPoint {
    const rect = this.viewport();
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    const view = this.camera.viewport.toGlobal(w, h);
    Vector3.ProjectToRef(world, IDENTITY, this.scene.getTransformMatrix(), view, this.tmp);

    const visible = Number.isFinite(this.tmp.x) && Number.isFinite(this.tmp.y) && this.tmp.z >= 0 && this.tmp.z <= 1;
    const px = visible ? rect.left + (this.tmp.x / w) * rect.width : rect.left + rect.width / 2;
    const py = visible ? rect.top + (this.tmp.y / h) * rect.height : rect.top + rect.height * 0.8;

    out.x = Math.min(rect.left + rect.width - EDGE_MARGIN, Math.max(rect.left + EDGE_MARGIN, px));
    out.y = Math.min(rect.top + rect.height - EDGE_MARGIN, Math.max(rect.top + EDGE_MARGIN, py));
    return out;
  }
}
