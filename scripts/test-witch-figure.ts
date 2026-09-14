/**
 * test-witch-figure.ts — smoke-тест процедурной фигурки ведьмы (witchFigure.ts).
 * Прогоняется в Node на NullEngine (как test-world-streamer.ts):
 *  - реальный проход генерации мира + стриминга → создание инстансов Witch;
 *  - проверка создания мешей, уникальности имён, масштаба;
 *  - idle-анимации (два аниматбла на ведьму после конструктора);
 *  - friendly-переключение: шляпа скрыта, маркер включён, платье осветлено и обратно;
 *  - setExpression / swingStaff / dispose без исключений и с корректным финальным состоянием.
 */
import { NullEngine, Scene, Color3, Camera, Vector3 } from "@babylonjs/core";
import { generateWorld } from "../src/world/WorldGenerator";
import { WorldStreamer } from "../src/world/WorldStreamer";
import { GameState } from "../src/core/GameState";

const EXPECTED_SCALE = 0.6;

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  }
}
function approx(a: number, b: number, eps = 1e-3): boolean {
  return Math.abs(a - b) <= eps;
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.activeCamera = new Camera("testCam", Vector3.Zero(), scene);
  const gameState = new GameState();
  const world = generateWorld(gameState, 42);
  const streamer = new WorldStreamer(scene, world, gameState);

  streamer.update(world.spawnPoint.x, world.spawnPoint.z);
  const witches = streamer.getActiveWitches();
  check(witches.length > 0, "у старта должны быть активные ведьмы");
  console.log(`активных ведьм у старта: ${witches.length}`);

  // --- Создание модели: меши, уникальные имена, масштаб, анимации ---
  const seenNames = new Set<string>();
  let totalMeshes = 0;
  for (const w of witches) {
    const root = w.root;
    check(approx(root.scaling.x, EXPECTED_SCALE) && approx(root.scaling.y, EXPECTED_SCALE), `масштаб ведьмы ${w.id} должен быть ${EXPECTED_SCALE}`);
    const meshes = root.getChildMeshes();
    totalMeshes += meshes.length;
    check(meshes.length >= 14, `у ${w.id} должно быть >= 14 мешей, есть ${meshes.length}`);
    for (const m of meshes) {
      check(!seenNames.has(m.name), `дубль имени меша: ${m.name}`);
      seenNames.add(m.name);
    }
    check(scene.getTransformNodeByName(`${w.id}_hat`) !== null, `у ${w.id} должна быть группа шляпы ${w.id}_hat`);
    check(scene.getTransformNodeByName(`${w.id}_witchRoot`) !== null, `у ${w.id} должен быть корень ${w.id}_witchRoot`);
  }
  console.log(`мешей на всех ведьм: ${totalMeshes}, дублей имён: ${seenNames.size !== totalMeshes ? "ЕСТЬ!" : "нет"}`);

  // idle запускается в конструкторе: 2 аниматбла (левая + правая рука) на ведьму
  check(scene.animatables.length >= witches.length * 2, `idle: ожидалось >= ${witches.length * 2} аниматблов, есть ${scene.animatables.length}`);
  console.log(`аниматблов (idle): ${scene.animatables.length}`);

  // --- Прогон кадров: анимации, обсервер рта, без исключений ---
  for (const w of witches) w.swingStaff();
  for (const w of witches) w.setExpression("angry");
  for (let i = 0; i < 30; i++) {
    scene.render();
    await sleep(5);
  }

  // Берём ведьму, чей цвет платья ЕЩЁ можно осветлить (r с запасом до 1) —
  // не жёстко witches[0]: какая именно ведьма (и с какой темой/цветом)
  // окажется первой у спавна, зависит от RNG-последовательности генератора,
  // а она законно сдвигается с каждой новой фичей генератора (например,
  // ниши/развилки добавляют свои rng()-вызовы). Тест должен проверять
  // МЕХАНИЗМ осветления, а не полагаться на то, что конкретному сиду
  // достанется не-белый цвет.
  const target = witches.find((w) => Color3.FromHexString(w.spell.color).r < 0.95) ?? witches[0];
  const spellColor = Color3.FromHexString(target.spell.color);

  // --- Friendly-переключение ---
  target.setFriendly(true);
  check(target.friendly === true, "setFriendly(true) должен выставить флаг");
  check(scene.getTransformNodeByName(`${target.id}_hat`)?.isEnabled() === false, "friendly: шляпа должна быть скрыта");
  check(scene.getMeshByName(`${target.id}_friendlyMarker`)?.isEnabled() === true, "friendly: маркер должен быть виден");
  const robeMat = scene.getMaterialByName(`${target.id}_robe`)!;
  check(
    !approx(robeMat.albedoColor.r, spellColor.r) && robeMat.albedoColor.r > spellColor.r,
    `friendly: платье должно осветлиться (r: ${robeMat.albedoColor.r.toFixed(3)} vs ${spellColor.r.toFixed(3)})`
  );
  console.log(`friendly: платье r=${robeMat.albedoColor.r.toFixed(3)} (было ${spellColor.r.toFixed(3)}) — осветлено`);

  target.setFriendly(false);
  check(target.friendly === false, "setFriendly(false) должен снять флаг");
  check(scene.getTransformNodeByName(`${target.id}_hat`)?.isEnabled() === true, "hostile: шляпа снова видна");
  check(scene.getMeshByName(`${target.id}_friendlyMarker`)?.isEnabled() === false, "hostile: маркер скрыт");
  const robeAfter = scene.getMaterialByName(`${target.id}_robe`)!;
  check(
    approx(robeAfter.albedoColor.r, spellColor.r) &&
      approx(robeAfter.albedoColor.g, spellColor.g) &&
      approx(robeAfter.albedoColor.b, spellColor.b),
    "hostile: цвет платья должен вернуться к цвету спелла"
  );

  // --- Dispose: материалы и ноды удалены ---
  const targetRootName = `${target.id}_witchRoot`;
  target.dispose();
  check(scene.getTransformNodeByName(targetRootName) === null, `после dispose корень ${targetRootName} должен быть удалён`);
  for (const matName of [`${target.id}_robe`, `${target.id}_skin`, `${target.id}_feltDark`, `${target.id}_friendlyMarkerMat`]) {
    check(scene.getMaterialByName(matName) === null, `после dispose материал ${matName} должен быть удалён`);
  }
  console.log("dispose: корень и материалы удалены");

  // --- Полный разбор мира: не должно быть исключений ---
  for (const w of [...streamer.getActiveWitches()]) w.dispose();

  if (failures === 0) {
    console.log("OK: процедурная фигурка ведьмы создаётся и анимируется корректно");
  } else {
    console.error(`FAILED: ${failures} нарушений`);
    process.exit(1);
  }
}

void main();