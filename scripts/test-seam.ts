// Диагностика швов развилки: для сида с развилкой печатаем кромки веток,
// границы проёмов и проверяем, что заплатки AB закрывают клин у входа в J.
import { generateWorld } from "../src/world/WorldGenerator";
import type { SectionSpec, SeamSpec } from "../src/world/spec/SectionSpec";

declare const process: { exit(code?: number): never };

function seamOf(world: ReturnType<typeof generateWorld>): { join: SectionSpec; seam: SeamSpec } | null {
  for (const s of world.sections) {
    if (s.seam) return { join: s, seam: s.seam };
  }
  return null;
}

let checked = 0;
let failed = 0;
for (let seed = 1; seed <= 60 && checked < 12; seed++) {
  const gs = new (require("../src/core/GameState").GameState)();
  const world = generateWorld(gs, seed);
  const hit = seamOf(world);
  if (!hit) continue;
  checked++;
  const { join, seam } = hit;
  const J_HALF = join.width / 2;
  let ok = true;
  for (const p of seam.patches) {
    // Печать углов для ручной проверки геометрии
    console.log(
      `  seed=${seed} J#${join.index} patch: edgeA=(${p.edgeA.x.toFixed(2)},${p.edgeA.z.toFixed(2)}) edgeB=(${p.edgeB.x.toFixed(2)},${p.edgeB.z.toFixed(2)}) outer=${p.outerCorner ? `(${p.outerCorner.x.toFixed(2)},${p.outerCorner.z.toFixed(2)})` : "null"}`
    );
    // Каждый угол заплатки должен быть в пределах коридора J по x.
    for (const c of [p.edgeA, p.edgeB, p.lineA, p.lineB]) {
      if (Math.abs(c.x) > J_HALF + 1e-6) {
        ok = false;
        console.log(`seed=${seed} J#${join.index}: угол заплатки за шириной J: x=${c.x.toFixed(2)} (limit ±${J_HALF})`);
      }
    }
    // Кромка должна висеть перед входом или на нём: edgeA/edgeB.z < overlap.
    // (иначе заплата не нужна)
    if (p.edgeA.z > 0 || p.edgeB.z > 0) {
      console.log(`seed=${seed} J#${join.index}: кромка ветки уже за линией входа J (z>0) — заплатка лишняя?`);
    }
  }
  // Задняя стена обязана существовать между проёмами обеих веток (бездна между кромками).
  if (seam.backWalls.length === 0) {
    ok = false;
    console.log(`seed=${seed} J#${join.index}: нет задней стены (проёмы веток накрывают всю линию входа?)`);
  }
  if (ok) console.log(`seed=${seed} J#${join.index}: seam OK patches=${seam.patches.length} backWalls=${seam.backWalls.length}`);
  else failed++;
}
console.log(`checked=${checked} failed=${failed}`);
if (failed > 0) process.exit(1);
