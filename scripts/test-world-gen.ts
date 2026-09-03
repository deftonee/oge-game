import { generateWorld, CORRIDOR_WIDTH } from "../src/world/WorldGenerator";
import { GameState } from "../src/core/GameState";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  }
}

for (let seed = 1; seed <= 200; seed++) {
  const gameState = new GameState();
  const world = generateWorld(gameState, seed);
  const sections = world.sections;

  check(sections.length >= 6, `seed ${seed}: ожидал >=6 секций (5-7 обычных + подход), получил ${sections.length}`);

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    check(Math.abs(s.endZ - s.startZ - s.length) < 1e-9, `seed ${seed} section ${i}: length не совпадает с endZ-startZ`);
    if (i > 0) {
      check(
        Math.abs(sections[i - 1].endZ - s.startZ) < 1e-9,
        `seed ${seed}: разрыв/нахлёст пола между секцией ${i - 1} (endZ=${sections[i - 1].endZ}) и ${i} (startZ=${s.startZ})`
      );
    }

    for (const w of s.witches) {
      check(w.z > s.startZ && w.z < s.endZ, `seed ${seed} section ${i}: ведьма ${w.id} вне границ секции по Z (${w.z})`);
      check(Math.abs(w.x) <= CORRIDOR_WIDTH / 2 - 1, `seed ${seed} section ${i}: ведьма ${w.id} вне коридора по X (${w.x})`);
    }
    for (const b of s.bonfires) {
      check(b.z > s.startZ && b.z < s.endZ, `seed ${seed} section ${i}: костёр ${b.id} вне границ секции по Z (${b.z})`);
    }
    for (const g of [...s.grass, ...s.borderLeft, ...s.borderRight]) {
      check(g.z >= s.startZ - 0.01 && g.z <= s.endZ + 0.01, `seed ${seed} section ${i}: декор вне границ по Z (${g.z})`);
    }
  }

  const first = sections[0];
  check(
    world.spawnPoint.z > first.startZ && world.spawnPoint.z < first.endZ,
    `seed ${seed}: точка спавна (z=${world.spawnPoint.z}) вне первой секции [${first.startZ}, ${first.endZ}]`
  );

  const last = sections[sections.length - 1];
  check(world.towerZ > last.endZ, `seed ${seed}: башня (z=${world.towerZ}) не дальше последней секции (endZ=${last.endZ})`);

  // Все id ведьм и костров уникальны в пределах мира
  const witchIds = new Set<string>();
  const bonfireIds = new Set<string>();
  for (const s of sections) {
    for (const w of s.witches) {
      check(!witchIds.has(w.id), `seed ${seed}: дублирующийся id ведьмы ${w.id}`);
      witchIds.add(w.id);
    }
    for (const b of s.bonfires) {
      check(!bonfireIds.has(b.id), `seed ${seed}: дублирующийся id костра ${b.id}`);
      bonfireIds.add(b.id);
    }
  }
}

if (failures === 0) {
  console.log("OK: все инварианты генерации мира прошли на 200 сидах");
} else {
  console.error(`FAILED: ${failures} нарушений инвариантов`);
  process.exit(1);
}
