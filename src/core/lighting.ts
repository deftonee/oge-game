import { Scene, HemisphericLight, DirectionalLight, Vector3 } from "@babylonjs/core";

/** Заполняющий верхний свет + направленное «солнце». */
export function setupLighting(scene: Scene): void {
  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.85;

  const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, 0.4), scene);
  sun.intensity = 0.5;
}
