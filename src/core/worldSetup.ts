import { Scene } from "@babylonjs/core";
import { GameState } from "./GameState";
import { generateWorld } from "../world/WorldGenerator";
import { WorldStreamer } from "../world/WorldStreamer";
import { buildTower } from "../world/Tower";
import { FogManager } from "../world/FogManager";

export interface WorldSetup {
  streamer: WorldStreamer;
  fog: FogManager;
  spawnPoint: { x: number; y: number; z: number };
}

/**
 * Сборка мира: сначала данные (сиды/позиции), затем потоковая система секций.
 * Башня строится один раз отдельно от стриминга — видна всегда; туман на
 * frontier отрисованных секций скрывает участок до неё.
 */
export function createWorld(scene: Scene, gameState: GameState): WorldSetup {
  const world = generateWorld(gameState);
  buildTower(scene, world.tower.x, world.tower.z);
  const streamer = new WorldStreamer(scene, world, gameState);
  const fog = new FogManager(scene, world);
  return { streamer, fog, spawnPoint: world.spawnPoint };
}
