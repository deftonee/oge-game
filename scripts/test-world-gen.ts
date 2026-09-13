import {
  generateWorld,
  localToWorld,
  distPointToSegment,
  yawAt,
  FIRST_SECTION_WIDTH,
  SECTION_WIDTH,
  DEADEND_LENGTH,
  SIDE_SPUR_WIDTH,
  SIDE_SPUR_LENGTH,
  SIDE_SPUR_MARGIN,
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
let totalDeadEnds = 0;
let totalSideSpurs = 0;

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
      check(s.curvature === 0, `seed ${seed}: первая секция (мягкий онбординг) должна быть прямой`);
    } else if (isBranch) {
      // Параллельный коридор-ветка развилки (проходная ИЛИ тупиковая)
      check(s.width === SECTION_WIDTH / 2, `seed ${seed}: ширина ветки = половина коридора (${s.width})`);
      if (s.isDeadEnd) {
        check(
          s.length >= DEADEND_LENGTH.min && s.length <= DEADEND_LENGTH.max,
          `seed ${seed}: длина тупика вне диапазона (${s.length.toFixed(1)})`
        );
        check(s.gates.length === 0, `seed ${seed}: тупик не должен иметь выходных ворот`);
      } else {
        check(s.length >= 22 && s.length <= 38, `seed ${seed}: длина ветки вне диапазона (${s.length.toFixed(1)})`);
        check(s.gates.length === 0, `seed ${seed}: ветка заканчивается свободным входом в схождение`);
      }
      check(!!s.forkGateId && s.forkParentIndex !== undefined, `seed ${seed}: ветка без привязки к воротам`);
      check(s.curvature === 0, `seed ${seed}: ветка развилки должна быть прямой (curvature=0)`);
    } else if (!isApproach) {
      // Обычная стволовая секция или схождение J
      check(s.width === SECTION_WIDTH, `seed ${seed}: обычная секция должна быть 3× ширины (${s.width})`);
      check(s.length >= 36 && s.length <= 54, `seed ${seed}: длина обычной секции вне диапазона (${s.length.toFixed(1)})`);
      if (isJoin) check(s.curvature === 0, `seed ${seed}: схождение J должно быть прямым (curvature=0)`);
    }

    // --- Дуга внутренне согласована: сохранённый end обязан совпасть с
    // формулой localToWorld(start, yaw, curvature, length) — иначе любой
    // потребитель (пол/стены/фог/стример), читающий end напрямую, разойдётся
    // с тем, что реально рисует ось секции. ---
    {
      const computedEnd = localToWorld(s, 0, s.length);
      check(
        Math.hypot(s.end.x - computedEnd.x, s.end.z - computedEnd.z) < 1e-6,
        `seed ${seed}: сохранённый end секции ${s.index} не совпадает с формулой дуги`
      );
    }

    // --- Сущности в локальных границах ---
    for (const w of s.witches) {
      check(w.z > 0 && w.z < s.length && Math.abs(w.x) <= s.width / 2 - 1, `seed ${seed}: ведьма вне границ секции`);
    }
    for (const b of s.bonfires) check(b.z > 0 && b.z < s.length, `seed ${seed}: костёр вне секции`);
    for (const p of s.practiceTargets) {
      check(p.z > 0 && p.z < s.length && Math.abs(p.x) <= s.width / 2 - 1, `seed ${seed}: цель вне границ`);
    }

    // --- Боковые ниши-тупики (SideSpurSpec): самостоятельная перпендикулярная
    // геометрия, а не приклеенная к телу секции. ---
    if (s.sideSpurs.length > 0) {
      totalSideSpurs += s.sideSpurs.length;
      check(
        s.index !== 0 && !isApproach && !isBranch,
        `seed ${seed}: ниша не должна появляться на первой/подходной секции или ветке развилки (секция ${s.index})`
      );
      for (const spur of s.sideSpurs) {
        check(spur.width === SIDE_SPUR_WIDTH, `seed ${seed}: ширина ниши ${spur.width} != ${SIDE_SPUR_WIDTH}`);
        check(
          spur.length >= SIDE_SPUR_LENGTH.min && spur.length <= SIDE_SPUR_LENGTH.max,
          `seed ${seed}: длина ниши вне диапазона (${spur.length.toFixed(1)})`
        );
        check(
          spur.doorZ >= SIDE_SPUR_MARGIN - 1e-6 && spur.doorZ <= s.length - SIDE_SPUR_MARGIN + 1e-6,
          `seed ${seed}: проём ниши слишком близко к концу секции (z=${spur.doorZ.toFixed(1)} из ${s.length.toFixed(1)})`
        );

        // Перпендикулярность: курс ниши = курс родителя в точке проёма ± 90°.
        // Курс всей трассы ограничен MAX_YAW (±1.05 рад) — обёртка угла через
        // (-π, π] тут не нужна, ±π/2 от него никогда не переваливает за π.
        const parentYawAtDoor = yawAt(s, spur.doorZ);
        const diff = Math.abs(spur.yaw - parentYawAtDoor);
        check(
          Math.abs(diff - Math.PI / 2) < 1e-9,
          `seed ${seed}: ниша должна отходить СТРОГО перпендикулярно (разница курса ${diff.toFixed(3)} рад)`
        );

        // Проём геометрически лежит на стене родителя в точке doorZ.
        const doorX = spur.side === "right" ? s.width / 2 : -s.width / 2;
        const expectedStart = localToWorld(s, doorX, spur.doorZ);
        check(
          Math.hypot(spur.start.x - expectedStart.x, spur.start.z - expectedStart.z) < 1e-6,
          `seed ${seed}: проём ниши не на стене родителя в заявленной точке`
        );

        // Ведьма и сундук — в границах РУКАВА ниши (собственная система координат).
        check(
          spur.witch.z > 0 && spur.witch.z < spur.length && Math.abs(spur.witch.x) <= spur.width / 2,
          `seed ${seed}: ведьма ниши вне границ рукава`
        );
        check(
          spur.chest.z > 0 && spur.chest.z < spur.length && Math.abs(spur.chest.x) <= spur.width / 2,
          `seed ${seed}: сундук ниши вне границ рукава`
        );
        check(
          spur.chest.bookIds.length + spur.chest.pageIds.length > 0,
          `seed ${seed}: сундук ниши без содержимого`
        );
      }
    }

    // --- Ворота ---
    if (s.gates.length === 1) {
      const g = s.gates[0];
      check(g.schoolId !== null, `seed ${seed}: ворота должны иметь школу`);
      check(Math.abs(g.x) < 1e-9 && Math.abs(g.width - (s.width - 0.4)) < 1e-9, `seed ${seed}: геометрия одиночных ворот`);
    } else if (s.gates.length === 2) {
      totalForks++;
      const [ga, gb] = s.gates;
      const junctionBranches = sections.filter((o) => o.forkBranch && o.forkParentIndex === s.index);
      const hasDeadEnd = junctionBranches.some((o) => o.isDeadEnd);
      if (hasDeadEnd) {
        totalDeadEnds++;
        check(
          ga.fork !== true && gb.fork !== true,
          `seed ${seed}: у развилки-тупика барьеры не должны быть односторонними (можно вернуться)`
        );
      } else {
        check(ga.fork === true && gb.fork === true, `seed ${seed}: ворота настоящей развилки должны быть односторонними`);
      }
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
        const parentEndYaw = yawAt(s, s.length);
        check(
          Math.abs(a.yaw - parentEndYaw) < 1e-9 && Math.abs(b.yaw - parentEndYaw) < 1e-9,
          `seed ${seed}: ветки не продолжают курс родителя на его конце`
        );
        check(a.curvature === 0 && b.curvature === 0, `seed ${seed}: ветки должны быть прямыми (curvature=0)`);
        check(
          !(a.isDeadEnd && b.isDeadEnd),
          `seed ${seed}: у развилки ${s.index} обе ветки тупиковые — тогда дальше пути вообще нет`
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
        // Новый инвариант кривизны: курс НАЧАЛА текущей секции обязан РОВНО
        // совпасть с курсом КОНЦА предыдущей — иначе на стыке снова появится
        // видимый излом (то, ради чего вся эта переделка и затевалась).
        check(
          Math.abs(s.yaw - yawAt(prev, prev.length)) < 1e-9,
          `seed ${seed}: излом курса на стыке ${prev.index}->${s.index} (нет непрерывности касательной)`
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
        // Тупиковая ветка НЕ обязана доставать до кромки J — в этом и есть
        // весь смысл тупика (см. isDeadEnd). Проверяем только ту ветку(-и),
        // что реально продолжается в J.
        if (!prev.isDeadEnd) {
          check(
            distPointToSegment(prev.end.x, prev.end.z, a.x, a.z, b.x, b.z) < 1e-6,
            `seed ${seed}: конец ветки B не на кромке J`
          );
        }
        if (!prevPrev.isDeadEnd) {
          check(
            distPointToSegment(prevPrev.end.x, prevPrev.end.z, a.x, a.z, b.x, b.z) < 1e-6,
            `seed ${seed}: конец ветки A не на кромке J`
          );
        }

        // Регрессия: J тоже не должно накладываться на коридор родителя.
        // sections.push(parent, branchA, branchB, join) кладёт их подряд,
        // поэтому родитель — три позиции назад от join. Проецируем на курс
        // родителя В ЕГО КОНЦЕ (а не в начале — теперь родитель сам может
        // изгибаться по своей длине, так что курс начала и конца отличаются).
        const parent = sections[i - 3];
        if (parent && parent.gates.length === 2) {
          const parentEndYaw = yawAt(parent, parent.length);
          const dirX = Math.sin(parentEndYaw);
          const dirZ = Math.cos(parentEndYaw);
          const projPastEnd = (s.start.x - parent.end.x) * dirX + (s.start.z - parent.end.z) * dirZ;
          check(
            projPastEnd >= -1e-6,
            `seed ${seed}: схождение ${s.index} накладывается на коридор родителя ${parent.index} ` +
              `(J не впереди конца родителя по его курсу, проекция ${projPastEnd.toFixed(1)})`
          );
        }
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

      // Регрессия: ветка обязана НАЧИНАТЬСЯ у КОНЦА родителя (где стоят её
      // ворота), а не поверх его собственного коридора. Раньше это ловилось
      // проекцией на ось родителя (совпадала с parent.length) — но родитель
      // теперь сам может изгибаться по своей длине, и проекция через
      // константный курс НАЧАЛА родителя перестаёт быть точной мерой
      // "пройденного расстояния" вдоль дуги. Проверяем вместо этого напрямую
      // (не зависит от кривизны): начало ветки лежит РОВНО в SECTION_WIDTH/4
      // от КОНЦА родителя (её боковое смещение при построении) — а не где-то
      // в районе parent.length от его начала, как было бы при баге со стартом
      // от cursor вместо end.
      const parent = sections.find((o) => o.index === s.forkParentIndex);
      if (parent) {
        const distFromParentEnd = Math.hypot(s.start.x - parent.end.x, s.start.z - parent.end.z);
        check(
          Math.abs(distFromParentEnd - SECTION_WIDTH / 4) < 1e-6,
          `seed ${seed}: ветка ${s.index} накладывается на коридор родителя ${parent.index} ` +
            `(начало ветки в ${distFromParentEnd.toFixed(1)} м от конца родителя вместо ${(SECTION_WIDTH / 4).toFixed(1)})`
        );
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
  const allWitchIds = sections.flatMap((s) => [...s.witches.map((w) => w.id), ...s.sideSpurs.map((sp) => sp.witch.id)]);
  check(new Set(allWitchIds).size === allWitchIds.length, `seed ${seed}: дубли id ведьм`);
  const allChestIds = sections.flatMap((s) => [...s.chests.map((c) => c.id), ...s.sideSpurs.map((sp) => sp.chest.id)]);
  check(new Set(allChestIds).size === allChestIds.length, `seed ${seed}: дубли id сундуков`);
  const gateIds = sections.flatMap((s) => s.gates.map((g) => g.id));
  check(new Set(gateIds).size === gateIds.length, `seed ${seed}: дубли id ворот`);
}

check(totalForks >= 40, `развилки должны иногда встречаться (на 200 сидах видели ${totalForks})`);
check(totalDeadEnds >= 10, `тупики должны иногда встречаться (на 200 сидах видели ${totalDeadEnds} из ${totalForks} развилок-вариантов)`);
check(totalSideSpurs >= 30, `боковые ниши должны иногда встречаться (на 200 сидах видели ${totalSideSpurs})`);

console.log(
  `Проверок: ${checks}, провалов: ${failures}, развилок на 200 сидах: ${totalForks} (из них тупиков: ${totalDeadEnds}), боковых ниш: ${totalSideSpurs}`
);
if (failures > 0) {
  console.error("FAILED: инварианты генерации мира нарушены");
  process.exit(1);
}
console.log("OK: все инварианты генерации мира прошли на 200 сидах");