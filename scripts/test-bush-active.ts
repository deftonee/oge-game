// Решающий тест: через WorldStreamer (как в реальной игре) — отслеживаем
// bush_ меши ПОСЛЕ стриминга, до и после scene.render().
import { NullEngine, Scene, Vector3, Camera } from "@babylonjs/core";
import { generateWorld } from "../src/world/WorldGenerator";
import { WorldStreamer } from "../src/world/WorldStreamer";
import { GameState } from "../src/core/GameState";

const engine = new NullEngine();
const scene = new Scene(engine);
scene.activeCamera = new Camera("testCam", new Vector3(0, 8, 0), scene);
const gameState = new GameState();
const world = generateWorld(gameState, 42);
const streamer = new WorldStreamer(scene, world, gameState);

streamer.update(world.spawnPoint.x, world.spawnPoint.z);
function dump(label: string): void {
  const bushes = scene.meshes.filter((m) => m.name.startsWith("bush"));
  const grass = scene.meshes.filter((m) => m.name.startsWith("grass"));
  console.log(`--- ${label}: bush=${bushes.length} grass=${grass.length}`);
  const grab = (m: any) => {
    const bi = m.getBoundingInfo().boundingBox;
    const cnt = m.thinInstanceCount ?? -1;
    const matrices = cnt > 0 ? m.thinInstanceWorldMatrices ?? null : null;
    let firstPos = "n/a";
    if (matrices && matrices.length >= 16) {
      firstPos = `(${matrices[12].toFixed(1)},${matrices[13].toFixed(2)},${matrices[14].toFixed(1)})`;
    }
    return `  ${m.name} thin=${cnt} y:[${bi.minimumWorld.y.toFixed(2)}..${bi.maximumWorld.y.toFixed(2)}] visible=${m.isVisible} m0=${firstPos}`;
  };
  for (const b of bushes.slice(0, 5)) console.log(grab(b));
  for (const g of grass.slice(0, 2)) console.log(grab(g));
}
dump("после стриминга");
scene.render();
dump("после render");
// Проверка activeMeshes
const am = scene.getActiveMeshes();
let bushActive = 0;
for (let i = 0; i < am.length; i++) if (am.data[i].name.startsWith("bush")) bushActive++;
console.log(`bush в activeMeshes: ${bushActive}`);
