import { Scene } from "@babylonjs/core";
import { GameState } from "./GameState";
import { generateWorld } from "../world/WorldGenerator";
import { WorldStreamer } from "../world/WorldStreamer";
import { buildTower } from "../world/Tower";
import { FogManager } from "../world/FogManager";
import type { GameSave, SavedWorld } from "../save/saveData";
import { worldSignature } from "../save/worldSignature";

export interface WorldSetup {
  streamer: WorldStreamer;
  fog: FogManager;
  /** Где появляется игрок: стартовая точка или, при продолжении, место из сохранения. */
  spawnPoint: { x: number; y: number; z: number };
  /** Какой мир создан: по seed и подписи сохранение узнаёт «тот же ли это мир». */
  world: SavedWorld;
  /** true — игра продолжена из сохранения (тот же мир, прогресс и позиция восстановлены). */
  resumed: boolean;
}

/**
 * Сборка мира: сначала данные (сиды/позиции), затем потоковая система секций.
 * Башня строится один раз отдельно от стриминга — видна всегда; туман на
 * frontier отрисованных секций скрывает участок до неё.
 *
 * С сохранением: мир генерируется с тем же seed и со СВЕЖИМ GameState — ровно как при первом
 * запуске (генерация читает состояние), и только потом в GameState возвращается прогресс. Если
 * подпись мира не совпала (с тех пор поменялся генератор), старый мир недоступен: создаётся новый,
 * в нём остаются книги, страницы и заклинания, а привязанное к старому миру (ведьмы, ворота,
 * сундуки, позиция) отбрасывается.
 */
export function createWorld(scene: Scene, gameState: GameState, save: GameSave | null = null): WorldSetup {
  let world = generateWorld(gameState, save?.world.seed);
  let signature = worldSignature(world);

  const sameWorld = save !== null && save.world.signature === signature;
  if (save && !sameWorld) {
    // eslint-disable-next-line no-console
    console.warn("[save] сохранённый мир больше не воспроизводится (изменился генератор): мир создан заново, общий прогресс сохранён");
    world = generateWorld(gameState);
    signature = worldSignature(world);
  }
  if (save) gameState.restore(save.progress, { world: sameWorld });

  buildTower(scene, world.tower.x, world.tower.z);
  const streamer = new WorldStreamer(scene, world, gameState);
  const fog = new FogManager(scene, world);

  const spawnPoint = save && sameWorld ? { x: save.player.x, y: world.spawnPoint.y, z: save.player.z } : world.spawnPoint;
  return { streamer, fog, spawnPoint, world: { seed: world.track?.seed ?? 0, signature }, resumed: sameWorld };
}
