/**
 * Инварианты закрытия щелей на стыках секций — геометрия ПОЛА и СТЕН мира
 * (в отличие от test-world-gen.ts, который проверяет только структуру spec).
 *
 * Это ровно то, из-за чего затевался рефакторинг SectionChunk.buildJointPatch:
 * на границе секций проходимая часть пола должна быть окружена стеной БЕЗ
 * щелей (нельзя провалиться, отступив вбок за стык) и БЕЗ лишних кусков
 * (нельзя застрять там, где на самом деле есть пол).
 *
 * Тест использует gapsAtJoint/subtractInterval — ТЕ ЖЕ САМЫЕ функции, которыми
 * реально пользуется SectionChunk при постройке геометрии (импортированы из
 * того же модуля geometry/SectionGeometry) — поэтому это не дублирование
 * формулы, а проверка настоящего поведения, а не переизобретённой копии.
 */
import {
  generateWorld,
  gapsAtJoint,
  subtractInterval,
} from "../src/world/WorldGenerator";
import { GameState } from "../src/core/GameState";

let checks = 0;
let failures = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

// --- 1. subtractInterval — чистая математика, несколько показательных случаев ---
{
  check(subtractInterval(-12, 12, -12, 12).length === 0, "subtractInterval: точное совпадение — 0 щелей");

  {
    const gaps = subtractInterval(-12, 12, -4, 4);
    check(gaps.length === 2, "subtractInterval: сужение с обеих сторон — 2 щели");
    check(
      Math.abs(gaps[0].start - -12) < 1e-9 && Math.abs(gaps[0].end - -4) < 1e-9,
      "subtractInterval: левая щель посчитана неверно"
    );
    check(
      Math.abs(gaps[1].start - 4) < 1e-9 && Math.abs(gaps[1].end - 12) < 1e-9,
      "subtractInterval: правая щель посчитана неверно"
    );
  }

  check(subtractInterval(-6, 6, -6, 6).length === 0, "subtractInterval: внутренний == внешний — 0 щелей");

  {
    // Сдвинутый внутренний интервал (как проекция родителя на ось ветки
    // развилки) — щель должна появиться РОВНО с той стороны, где не хватает.
    const gaps = subtractInterval(-6, 18, -6, 6);
    check(gaps.length === 1, "subtractInterval: сдвинутый внутренний интервал — ровно одна щель");
    check(
      gaps.length === 1 && Math.abs(gaps[0].start - 6) < 1e-9 && Math.abs(gaps[0].end - 18) < 1e-9,
      "subtractInterval: щель не там, где ожидалось"
    );
  }

  {
    // Внутренний интервал вообще не пересекается с внешним — защита от
    // битых данных: лучше закрыть весь outer стеной, чем оставить дыру.
    const gaps = subtractInterval(-6, 6, 20, 30);
    check(
      gaps.length === 1 && gaps[0].start === -6 && gaps[0].end === 6,
      "subtractInterval: непересекающийся внутренний интервал должен закрыть outer целиком"
    );
  }
}

// --- 2. gapsAtJoint на реальных сгенерированных мирах ---
let widenChecks = 0;
let branchChecks = 0;
let seamCount = 0;

for (let seed = 1; seed <= 300; seed++) {
  const gameState = new GameState();
  const world = generateWorld(gameState, seed);
  const sections = world.sections;

  for (const s of sections) {
    if (s.index === 0 || s.prevWidth <= 0) continue;

    if (s.seam) {
      // buildJointPatch такие секции пропускает целиком (курс на стыке
      // разрывен — прямая проекция для них систематически неточна, см.
      // комментарий в SectionChunk.buildJointPatch) — полноту покрытия
      // входа J проверяем отдельно, ниже, по данным самого шва.
      seamCount++;
      continue;
    }

    const gaps = gapsAtJoint(s);
    const half = s.width / 2;

    // Щели (если есть) лежат СТРОГО внутри собственной ширины секции и не
    // пересекаются друг с другом — иначе стены наложатся или вылезут за
    // пределы коридора.
    for (const g of gaps) {
      check(
        g.start >= -half - 1e-6 && g.end <= half + 1e-6,
        `seed ${seed} #${s.index}: щель стыка (${g.start.toFixed(2)}..${g.end.toFixed(2)}) выходит за ширину секции (±${half})`
      );
      check(g.end > g.start, `seed ${seed} #${s.index}: щель стыка вырожденная`);
    }
    if (gaps.length === 2) {
      check(gaps[0].end <= gaps[1].start + 1e-6, `seed ${seed} #${s.index}: две щели стыка пересекаются`);
    }

    if (s.forkBranch) {
      branchChecks++;
      // Ключевой инвариант рефакторинга: у ветки развилки щелей на стыке
      // НЕ должно быть вовсе — она примыкает своей ПОЛНОЙ шириной к полу
      // родителя (соседняя ветка занимает ровно оставшуюся половину, см.
      // TrackBuilder.appendFork) — отдельный случай ей не нужен, а лишняя
      // геометрия здесь означала бы стену прямо в проёме, откуда не выйти.
      check(gaps.length === 0, `seed ${seed} #${s.index}: у ветки развилки не должно быть щели стыка (нашли ${gaps.length})`);
      continue;
    }

    // Не ветка и не шов — стык без бокового смещения оси (start совпадает
    // с prevEnd), поэтому открытый проём обязан ТОЧНО совпасть с меньшей из
    // двух ширин: остальное — щель, требующая стены.
    const openWidth = s.width - gaps.reduce((sum, g) => sum + (g.end - g.start), 0);
    const expectedOpen = Math.min(s.width, s.prevWidth);
    check(
      Math.abs(openWidth - expectedOpen) < 1e-6,
      `seed ${seed} #${s.index}: открытый проём на стыке ${openWidth.toFixed(2)} != ожидаемого ${expectedOpen.toFixed(2)}`
    );

    if (Math.abs(s.width - s.prevWidth) < 1e-9) {
      check(gaps.length === 0, `seed ${seed} #${s.index}: ширина не изменилась, а щель на стыке нашлась`);
    } else {
      widenChecks++;
      check(gaps.length === 2, `seed ${seed} #${s.index}: смена ширины должна закрываться двумя щелями (нашли ${gaps.length})`);
    }
  }

  // --- 3. Полнота покрытия входа J: заплатки (buildSeam) + задняя стена
  // должны без щелей замостить ВСЮ линию входа [-half, half]. Та же идея,
  // что и gapsAtJoint, но для схождения щели считает и закрывает buildSeam
  // по собственным, более точным данным (см. TrackBuilder.computeSeam) —
  // здесь просто проверяем результат на полноту и непрерывность.
  for (const s of sections) {
    if (!s.seam) continue;
    const half = s.width / 2;
    const covered: { start: number; end: number }[] = [];
    for (const p of s.seam.patches) {
      covered.push({ start: Math.min(p.lineA.x, p.lineB.x), end: Math.max(p.lineA.x, p.lineB.x) });
    }
    for (const bw of s.seam.backWalls) {
      covered.push({ start: Math.min(bw.from.x, bw.to.x), end: Math.max(bw.from.x, bw.to.x) });
    }
    covered.sort((a, b) => a.start - b.start);

    check(covered.length > 0, `seed ${seed} #${s.index}: вход J ничем не покрыт (ни заплаткой, ни задней стеной)`);
    if (covered.length === 0) continue;

    const TOL = 0.05; // допуск на нахлёст заплаток/стен (0.5 м) и численный шум
    check(
      covered[0].start <= -half + TOL,
      `seed ${seed} #${s.index}: вход J не покрыт от левого края (первое покрытие с ${covered[0].start.toFixed(2)}, край ${(-half).toFixed(2)})`
    );
    check(
      covered[covered.length - 1].end >= half - TOL,
      `seed ${seed} #${s.index}: вход J не покрыт до правого края (последнее покрытие до ${covered[covered.length - 1].end.toFixed(2)}, край ${half.toFixed(2)})`
    );
    for (let i = 1; i < covered.length; i++) {
      check(
        covered[i].start <= covered[i - 1].end + TOL,
        `seed ${seed} #${s.index}: щель во входе J между x=${covered[i - 1].end.toFixed(2)} и x=${covered[i].start.toFixed(2)}`
      );
    }
  }
}

check(widenChecks >= 250, `ожидали расширение входа (8→24) почти на каждом из 300 сидов, нашли ${widenChecks}`);
check(branchChecks >= 100, `ожидали много веток развилки на 300 сидах, нашли ${branchChecks}`);
check(seamCount >= 40, `ожидали много схождений J на 300 сидах, нашли ${seamCount}`);

console.log(
  `Проверок: ${checks}, провалов: ${failures}; расширений входа: ${widenChecks}, веток развилки: ${branchChecks}, схождений J: ${seamCount}`
);
if (failures > 0) {
  console.error("FAILED: на стыках секций найдены щели и/или лишняя геометрия");
  process.exit(1);
}
console.log("OK: пол на всех стыках секций окружён стеной без щелей и без лишней геометрии");
