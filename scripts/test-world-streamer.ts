import { NullEngine, Scene } from "@babylonjs/core";
import { generateWorld } from "../src/world/WorldGenerator";
import { WorldStreamer } from "../src/world/WorldStreamer";
import { GameState } from "../src/core/GameState";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  }
}

const engine = new NullEngine();
const scene = new Scene(engine);
const gameState = new GameState();
const world = generateWorld(gameState, 42);
const streamer = new WorldStreamer(scene, world, gameState);

// Приватного доступа к chunks у нас нет, поэтому проверяем через публичное поведение:
// количество активных ведьм/костров и факт, что оно вообще меняется при движении.

streamer.update(world.spawnPoint.z);
const initialWitches = streamer.getActiveWitches();
const initialBonfires = streamer.getActiveBonfires();
check(initialBonfires.length > 0, "у старта должен быть виден хотя бы один костёр (окно ±1 секции)");
console.log(`старт: ${initialWitches.length} ведьм, ${initialBonfires.length} костров видно`);

// Двигаемся вперёд по всей длине мира с шагом и следим, что число построенных
// секций (через число видимых ведьм+костров) не "взрывается" — то есть старые
// секции реально выгружаются, а не копятся.
const lastSection = world.sections[world.sections.length - 1];
let maxEntitiesSeenAtOnce = 0;
for (let z = world.spawnPoint.z; z <= lastSection.endZ; z += 3) {
  streamer.update(z);
  const count = streamer.getActiveWitches().length + streamer.getActiveBonfires().length;
  maxEntitiesSeenAtOnce = Math.max(maxEntitiesSeenAtOnce, count);
}
const totalWitchesInWorld = world.sections.reduce((sum, s) => sum + s.witches.length, 0);
const totalBonfiresInWorld = world.sections.reduce((sum, s) => sum + s.bonfires.length, 0);
console.log(
  `всего в мире: ${totalWitchesInWorld} ведьм, ${totalBonfiresInWorld} костров; максимум одновременно видно: ${maxEntitiesSeenAtOnce}`
);
check(
  maxEntitiesSeenAtOnce < totalWitchesInWorld + totalBonfiresInWorld,
  "число одновременно построенных сущностей должно быть меньше общего числа в мире — иначе стриминг не выгружает секции"
);

// Побеждаем первую попавшуюся ведьму, уходим далеко вперёд и возвращаемся —
// она не должна возникнуть заново.
streamer.update(world.spawnPoint.z);
const target = streamer.getActiveWitches()[0];
check(!!target, "должна быть хотя бы одна ведьма у старта для теста на побед/пересборку");
if (target) {
  gameState.markWitchDefeated(target.id);
  streamer.update(lastSection.endZ - 1); // уходим в конец мира — секция старта выгружается
  streamer.update(world.spawnPoint.z); // возвращаемся — секция старта пересобирается
  const stillThere = streamer.getActiveWitches().some((w) => w.id === target.id);
  check(!stillThere, `побеждённая ведьма ${target.id} не должна появляться снова после пересборки секции`);
}

if (failures === 0) {
  console.log("OK: стриминг секций и персистентность побеждённых ведьм работают корректно");
} else {
  console.error(`FAILED: ${failures} нарушений`);
  process.exit(1);
}
