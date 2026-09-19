import { generateWorld, extendWorld } from "../src/world/WorldGenerator";
import { GameState } from "../src/core/GameState";
import { distPointToSectionAxis } from "../src/world/geometry/SectionGeometry";

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

for (let seed = 1; seed <= 40; seed++) {
  const gs = new GameState();
  const base = generateWorld(gs, seed);
  const extended = extendWorld(base, gs, 3);

  check(!!base.track, `seed ${seed}: у мира нет снапшота трассы`);
  check(extended.sections.length > base.sections.length, `seed ${seed}: мир не удлинился`);
  check(extended.track?.specIndex !== base.track?.specIndex, `seed ${seed}: specIndex не продвинулся`);

  const approaches = extended.sections.filter((s) => s.tier === 0);
  check(approaches.length === 1, `seed ${seed}: подходов ${approaches.length}, ожидался 1`);
  check(extended.sections[extended.sections.length - 1].tier === 0, `seed ${seed}: подход не последний`);

  // Первые боевые секции базового мира сохранены как префикс.
  const baseCombat = base.sections.filter((s) => s.tier !== 0);
  const extCombat = extended.sections.filter((s) => s.tier !== 0);
  check(extCombat.length >= baseCombat.length + 3, `seed ${seed}: добавлено меньше 3 боевых секций (${extCombat.length} vs ${baseCombat.length})`);
  // Префикс боевых секций сохраняется КРОМЕ последней базовой: у неё снят барьер
  // подхода и назначен обычный выходной (она снова середина трассы).
  const comparable = baseCombat.slice(0, baseCombat.length - 1);
  check(
    JSON.stringify(extCombat.slice(0, comparable.length)) === JSON.stringify(comparable),
    `seed ${seed}: префикс боевых секций изменился при продлении`
  );
  check(
    extCombat[comparable.length].gates.length >= 1,
    `seed ${seed}: последняя базовая секция осталась без выходного барьера после продления`
  );

  // Уникальность id по всему продлённому миру.
  const witchIds = extCombat.flatMap((s) => [...s.witches.map((w) => w.id), ...s.sideSpurs.map((sp) => sp.witch.id)]);
  const chestIds = extCombat.flatMap((s) => [...s.chests.map((c) => c.id), ...s.sideSpurs.map((sp) => sp.chest.id)]);
  const gateIds = extCombat.flatMap((s) => s.gates.map((g) => g.id));
  check(new Set(witchIds).size === witchIds.length, `seed ${seed}: дубли id ведьм после продления`);
  check(new Set(chestIds).size === chestIds.length, `seed ${seed}: дубли id сундуков после продления`);
  check(new Set(gateIds).size === gateIds.length, `seed ${seed}: дубли id ворот после продления`);

  // Стык: каждая боевая секция (кроме веток/первой) начинается на конце предыдущей по стволу.
  for (let i = 1; i < extCombat.length; i++) {
    const s = extCombat[i];
    const prev = extCombat[i - 1];
    if (s.forkBranch || prev.forkBranch) continue;
    if (s.tier === 0) continue;
    check(distPointToSectionAxis(s.start.x, s.start.z, { ...prev, length: prev.length }) < 1e-3 ||
      Math.hypot(s.start.x - prev.end.x, s.start.z - prev.end.z) < 1e-6,
      `seed ${seed}: разрыв стыка боевых секций ${prev.index}->${s.index}`);
  }
}

// Детерминизм продления: тот же снапшот → те же новые секции.
{
  const a = extendWorld(generateWorld(new GameState(), 7), new GameState(), 2);
  const b = extendWorld(generateWorld(new GameState(), 7), new GameState(), 2);
  check(JSON.stringify(a.sections) === JSON.stringify(b.sections), "продление недетерминировано");
}

console.log(failures === 0 ? "OK: extendWorld — продление мира, уникальность id, стыки, детерминизм" : `FAILED: ${failures}`);
if (failures > 0) process.exit(1);
