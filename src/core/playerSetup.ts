import { Scene, ArcRotateCamera, Vector3 } from "@babylonjs/core";
import { PlayerController } from "./PlayerController";

export function createPlayer(
  scene: Scene,
  spawn: { x: number; y: number; z: number }
): PlayerController {
  return new PlayerController(scene, new Vector3(spawn.x, spawn.y, spawn.z));
}

/**
 * Орбитальная камера от третьего лица вокруг игрока. Ограничения по высоте,
 * дистанции и запрет панорамирования — чтобы камера не уходила за пределы
 * коридора и не выламывалась под землю.
 */
export function createOrbitCamera(
  scene: Scene,
  canvas: HTMLCanvasElement,
  player: PlayerController
): ArcRotateCamera {
  const camera = new ArcRotateCamera(
    "camera",
    -Math.PI / 2,
    Math.PI / 2.6,
    9,
    player.position,
    scene
  );
  camera.lowerBetaLimit = 0.5;
  camera.upperBetaLimit = Math.PI / 2.1;
  camera.lowerRadiusLimit = 4;
  camera.upperRadiusLimit = 14;
  camera.wheelPrecision = 40;
  camera.attachControl(canvas, true);
  camera.checkCollisions = false;
  camera.panningSensibility = 0; // запрет панорамирования правой кнопкой
  return camera;
}
