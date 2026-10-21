import type { ControlSettings, RenderScale } from "../settings/settings";

/**
 * Применение настроек к живым объектам игры. Чистые функции от «данные + объект»:
 * вызываются при запуске и при каждом изменении в меню — так настройки действуют
 * сразу, без перезапуска (кроме уровня качества, см. core/quality).
 */

/** Чувствительность ArrowRotateCamera по умолчанию в Babylon: больше число — медленнее поворот. */
export const BASE_ANGULAR_SENSIBILITY = 1000;

interface SensibilityTarget {
  angularSensibilityX: number;
  angularSensibilityY: number;
}

/**
 * Скорость поворота камеры мышью/пальцем и инверсия вертикали. В Babylon смещение
 * делится на angularSensibility, поэтому множитель чувствительности — в знаменателе, а
 * инверсия — это отрицательное значение по Y.
 */
export function applyCameraSettings(camera: SensibilityTarget, controls: Pick<ControlSettings, "mouseSensitivity" | "invertY">): void {
  const base = BASE_ANGULAR_SENSIBILITY / controls.mouseSensitivity;
  camera.angularSensibilityX = base;
  camera.angularSensibilityY = controls.invertY ? -base : base;
}

/**
 * Уровень hardware scaling для доли родного разрешения. Движок создан с
 * adaptToDeviceRatio, то есть «родной» уровень = 1 / devicePixelRatio; доля 0.5
 * рисует вдвое меньше точек по каждой оси (в 4 раза меньше пикселей).
 */
export function hardwareScalingLevel(scale: RenderScale, devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return 1 / (dpr * scale);
}

export function applyRenderScale(
  engine: { setHardwareScalingLevel(level: number): void },
  scale: RenderScale,
  devicePixelRatio: number = typeof window !== "undefined" ? window.devicePixelRatio : 1
): void {
  engine.setHardwareScalingLevel(hardwareScalingLevel(scale, devicePixelRatio));
}
