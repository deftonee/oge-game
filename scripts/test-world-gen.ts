import {
  generateWorld,
  localToWorld,
  distPointToSegment,
  FIRST_SECTION_WIDTH,
  SECTION_WIDTH,
} from "../src/world/WorldGenerator";
import { GameState } from "../src/core/GameState";

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

let totalForks = 0;

for (let seed = 1; seed <= 200; seed++) {
  const gameState = new GameState();
  const world = generateWorld(gameState, seed);
  const sections = world.sections;

  check(sections.length >= 5, `seed ${seed}: мир слишком короткий`);
  check(sections.every((s) => s.partitionDepth === 0), `seed ${seed}: стена-разделитель больше не нужна`);

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const prev = i > 0 ? sections[i - 1] : null;
    const isBranch = !!s.forkBranch;
    const isJoin = !!prev && prev.forkBranch && !isBranch && s.index === prev.index + 1;
    const isApproach = s.tier === 0;

    // --- Размеры ---
    if (s.index === 0) {
      check(s.width === FIRST_SECTION_WIDTH, `seed ${seed}: первая секция должна быть узкой (${s.width})`);
      check(s.length >= 12 && s.length <= 18, `seed ${seed}: длина первой секции вне диапазона`);
      check(s.witches.length === 0, `seed ${seed}: в первой секции не должно быть ведьм`);
      check(s.gates.length === 1, `seed ${seed}: вход в игру — одиночный барьер`);
      check(!s.forkBranch, `seed ${seed}: первая секция не ветка`);
    } else if (isBranch) {
      // Параллельный коридор-ветка развилки
      check(s.width === SECTION_WIDTH / 2, `seed ${seed}: ширина ветки = половина коридора (${s.width})`);
      check(s.length >= 22 && s.length <= 38, `seed ${seed}: длина ветки вне диапазона (${s.length.toFixed(1)})`);
      check(s.gates.length === 0, `seed ${seed}: ветка заканчивается свободным входом в схождение`);
      check(!!s.forkGateId && s.forkParentIndex !== undefined, `seed ${seed}: ветка без привязки к воротам`);
      check(s.jointRadius === 0, `seed ${seed}: стык ветки прямой, клина быть не должно`);
    } else if (!isApproach) {
      // Обычная стволовая секция или схождение J
      check(s.width === SECTION_WIDTH, `seed ${seed}: обычная секция должна быть 3× ширины (${s.width})`);
      check(s.length >= 36 && s.length <= 54, `seed ${seed}: длина обычной секции вне диапазона (${s.length.toFixed(1)})`);
    }

    // --- Сущности в локальных границах ---
    for (const w of s.witches) {
      check(w.z > 0 && w.z < s.length && Math.abs(w.x) <= s.width / 2 - 1, `seed ${seed}: ведьма вне границ секции`);
    }
    for (const b of s.bonfires) check(b.z > 0 && b.z < s.length, `seed ${seed}: костёр вне секции`);
    for (const p of s.practiceTargets) {
      check(p.z > 0 && p.z < s.length && Math.abs(p.x) <= s.width / 2 - 1, `seed ${seed}: цель вне границ`);
    }

    // --- Ворота ---
    if (s.gates.length === 1) {
      const g = s.gates[0];
      check(g.schoolId !== null, `seed ${seed}: ворота должны иметь школу`);
      check(Math.abs(g.x) < 1e-9 && Math.abs(g.width - (s.width - 0.4)) < 1e-9, `seed ${seed}: геометрия одиночных ворот`);
    } else if (s.gates.length === 2) {
      totalForks++;
      const [ga, gb] = s.gates;
      check(ga.fork === true && gb.fork === true, `seed ${seed}: ворота развилки должны быть односторонними`);
      check(ga.schoolId !== gb.schoolId, `seed ${seed}: два барьера развилки — разные школы`);
      check(Math.abs(Math.abs(ga.x) - s.width / 4) < 1e-9 && Math.abs(Math.abs(gb.x) - s.width / 4) < 1e-9, `seed ${seed}: x барьеров = ±w/4`);
      check(Math.abs(ga.width - (s.width / 2 - 0.3)) < 1e-9, `seed ${seed}: ширина барьера = половина коридора`);
    }
    if (isApproach) check(s.gates.length === 0, `seed ${seed}: у подхода не должно быть выхода`);

    // --- Ветвление по воротам: развилка связана ровно с парой веток и схождением ---
    if (s.gates.length === 2) {
      const branches = sections.filter((o) => o.forkBranch && o.forkParentIndex === s.index);
      check(branches.length === 2, `seed ${seed}: у развилки ${s.index} веток ${branches.length}, ожидалось ровно 2`);
      const a = branches.find((o) => o.forkBranch === "a");
      const b = branches.find((o) => o.forkBranch === "b");
      check(!!a && !!b, `seed ${seed}: развилка ${s.index} без пары веток A/B`);
      if (a && b) {
        check(
          a.forkGateId === s.gates[0].id && b.forkGateId === s.gates[1].id,
          `seed ${seed}: ветки привязаны не к своим воротам (${a.forkGateId}, ${b.forkGateId})`
        );
        check(a.index === s.index + 1 && b.index === s.index + 1, `seed ${seed}: индекс ветки != parent+1`);
        check(
          Math.abs(a.yaw - s.yaw) < 1e-9 && Math.abs(b.yaw - s.yaw) < 1e-9,
          `seed ${seed}: ветки не параллельны родителю`
        );
      }
      const join = sections.find((o) => !o.forkBranch && o.index === s.index + 2);
      check(!!join, `seed ${seed}: у развилки ${s.index} нет схождения J (индекс parent+2)`);
    }

    // --- Стыки ---
    if (i > 0 && prev) {
      if (!isBranch && !prev.forkBranch) {
        // Обычный стык: следующая секция начинается ровно там, где кончилась prev
        check(
          Math.hypot(s.start.x - prev.end.x, s.start.z - prev.end.z) < 1e-6,
          `seed ${seed}: разрыв стыка секций ${prev.index}->${s.index}`
        );
      }
      if (isJoin) {
        // Схождение: концы ОБЕИХ веток лежат на входной кромке J
        const half = SECTION_WIDTH / 2;
        const perpX = Math.cos(s.yaw);
        const perpZ = -Math.sin(s.yaw);
        const a = { x: s.start.x - perpX * half, z: s.start.z - perpZ * half };
        const b = { x: s.start.x + perpX * half, z: s.start.z + perpZ * half };
        const prevPrev = sections[i - 2];
        check(
          distPointToSegment(prev.end.x, prev.end.z, a.x, a.z, b.x, b.z) < 1e-6,
          `seed ${seed}: конец ветки B не на кромке J`
        );
        check(
          distPointToSegment(prevPrev.end.x, prevPrev.end.z, a.x, a.z, b.x, b.z) < 1e-6,
          `seed ${seed}: конец ветки A не на кромке J`
        );
      }
    }

    // --- Ветки вилки: параллельны, смещены поперёк ---
    if (isBranch) {
      const pair = sections.find((o) => o.forkBranch && o.forkBranch !== s.forkBranch && o.forkParentIndex === s.forkParentIndex);
      check(!!pair, `seed ${seed}: ветке не нашлась пара`);
      if (pair) {
        check(Math.abs(s.yaw - pair.yaw) < 1e-9, `seed ${seed}: ветки должны быть параллельны`);
        const dx = pair.start.x - s.start.x;
        const dz = pair.start.z - s.start.z;
        const dirX = Math.sin(s.yaw);
        const dirZ = Math.cos(s.yaw);
        check(Math.abs(dx * dirX + dz * dirZ) < 1e-6, `seed ${seed}: ветки должны быть смещены поперёк, а не вдоль`);
        check(Math.abs(Math.hypot(dx, dz) - SECTION_WIDTH / 2) < 1e-6, `seed ${seed}: смещение веток = w/2`);
      }
    }
  }

  // --- Спавн внутри первой секции ---
  const first = sections[0];
  const d0 = distPointToSegment(world.spawnPoint.x, world.spawnPoint.z, first.start.x, first.start.z, first.end.x, first.end.z);
  check(d0 < first.width / 2, `seed ${seed}: спавн не на первой секции`);

  // --- Башня за подходом, по направлению его оси ---
  const approach = sections[sections.length - 1];
  check(approach.tier === 0, `seed ${seed}: последняя секция — подход`);
  const dirX = Math.sin(approach.yaw);
  const dirZ = Math.cos(approach.yaw);
  const t = { x: world.tower.x - approach.end.x, z: world.tower.z - approach.end.z };
  check(t.x * dirX + t.z * dirZ > 0, `seed ${seed}: башня впереди подхода по направлению оси`);

  // --- Вход в подход гейтится одиночным барьером на последней боевой секции ---
  const approachIdx = sections.findIndex((s2) => s2.tier === 0);
  if (approachIdx > 0) {
    const prevSection = sections[approachIdx - 1];
    check(
      prevSection.gates.length === 1 && prevSection.gates[0].id === "gate-approach" && prevSection.gates[0].x === 0,
      `seed ${seed}: перед подходом нет одиночного барьера gate-approach`
    );
    check(
      Math.hypot(approach.start.x - prevSection.end.x, approach.start.z - prevSection.end.z) < 1e-6,
      `seed ${seed}: подход оторван от последней секции`
    );
  }

  // --- Уникальность id ---
  const allWitchIds = sections.flatMap((s) => s.witches.map((w) => w.id));
  check(new Set(allWitchIds).size === allWitchIds.length, `seed ${seed}: дубли id ведьм`);
  const gateIds = sections.flatMap((s) => s.gates.map((g) => g.id));
  check(new Set(gateIds).size === gateIds.length, `seed ${seed}: дубли id ворот`);
}

check(totalForks >= 40, `развилки должны иногда встречаться (на 200 сидах видели ${totalForks})`);

console.log(`Проверок: ${checks}, провалов: ${failures}, развилок на 200 сидах: ${totalForks}`);
if (failures > 0) {
  console.error("FAILED: инварианты генерации мира нарушены");
  process.exit(1);
}
console.log("OK: все инварианты генерации мира прошли на 200 сидах");