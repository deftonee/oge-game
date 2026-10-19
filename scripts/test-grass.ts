// Трава (render/grass): геометрия пучка, раскладка тонкими инстансами, бюджет
// треугольников по уровням качества и интеграция в SectionChunk (NullEngine).
import { NullEngine, Scene, VertexBuffer, Vector3 } from "@babylonjs/core";
import {
  GRASS_TUFT_MAX_HEIGHT,
  GRASS_TUFT_RADIUS,
  createGrassTuft,
  scatterGrass,
  tuftTint,
} from "../src/render/grass";
import { QUALITY_PROFILES, setQualityTier } from "../src/core/quality";
import { generateWorld } from "../src/world/WorldGenerator";
import { FootprintIndex } from "../src/world/geometry/Footprint";
import { SectionChunk } from "../src/world/SectionChunk";
import { GameState } from "../src/core/GameState";

declare const process: { exit(code?: number): never };

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

const realLog = console.log;
console.log = () => {}; // сборка чанков печатает [stream]-логи

const engine = new NullEngine();
const scene = new Scene(engine);

// --- 1. Геометрия пучка ------------------------------------------------------
for (const tier of ["low", "mid", "high"] as const) {
  const blades = QUALITY_PROFILES[tier].grassBladesPerTuft;
  const tuft = createGrassTuft(scene, `tuft_${tier}`, blades);
  const pos = tuft.getVerticesData(VertexBuffer.PositionKind)!;
  const colors = tuft.getVerticesData(VertexBuffer.ColorKind);
  const normals = tuft.getVerticesData(VertexBuffer.NormalKind)!;
  const indices = tuft.getIndices()!;
  const verts = pos.length / 3;

  check(verts === blades * 5, `${tier}: 5 вершин на травинку (${verts})`);
  check(indices.length / 3 === blades * 3, `${tier}: 3 треугольника на травинку (${indices.length / 3})`);
  check(!!colors && colors.length === verts * 4, `${tier}: у каждой вершины есть цвет`);
  check(Array.from(pos).concat(Array.from(normals), Array.from(colors ?? [])).every(Number.isFinite), `${tier}: нет NaN/Infinity`);
  check(colors !== null && Array.from(colors).every((c) => c >= 0 && c <= 1), `${tier}: цвета в диапазоне [0,1]`);
  check(indices.every((i) => i >= 0 && i < verts), `${tier}: индексы в пределах вершин`);

  let minY = Infinity;
  let maxY = -Infinity;
  let maxR = 0;
  for (let i = 0; i < verts; i++) {
    minY = Math.min(minY, pos[i * 3 + 1]);
    maxY = Math.max(maxY, pos[i * 3 + 1]);
    maxR = Math.max(maxR, Math.hypot(pos[i * 3], pos[i * 3 + 2]));
  }
  check(minY >= 0 && minY < 1e-6, `${tier}: низ пучка ровно на земле (minY=${minY})`);
  check(maxY <= GRASS_TUFT_MAX_HEIGHT && maxY > 0.3, `${tier}: высота пучка ${maxY.toFixed(2)} м в пределах бюджета`);
  check(maxR <= GRASS_TUFT_RADIUS, `${tier}: радиус пучка ${maxR.toFixed(2)} м не больше ${GRASS_TUFT_RADIUS}`);
  check(tuft.position.lengthSquared() === 0 && tuft.isPickable === false, `${tier}: база в identity-трансформе и не pickable`);
  check(tuft.material?.backFaceCulling === false, `${tier}: материал двусторонний (травинка — плоский лист)`);

  // Бюджет: пучок(и) на сид дешевле старого конуса (CreateCylinder по умолчанию → 96 треугольников).
  const trisPerSeed = (indices.length / 3) * QUALITY_PROFILES[tier].grassTuftsPerSeed;
  check(trisPerSeed < 96, `${tier}: ${trisPerSeed} треугольников на сид — легче старого конуса (96)`);
}
check(
  createGrassTuft(scene, "t1", 4).material === createGrassTuft(scene, "t2", 6).material,
  "материал травы общий на сцену (не по одному на пучок)"
);

// --- 2. Раскладка ------------------------------------------------------------
{
  const blades = 5;
  const tuftsPerSeed = 3;
  const seeds = Array.from({ length: 40 }, (_, i) => ({ x: i * 1.7 - 30, z: (i % 7) * 2.3 + 4, rot: i * 0.37, scale: 0.7 + (i % 6) * 0.12 }));

  const a = createGrassTuft(scene, "scatterA", blades);
  const b = createGrassTuft(scene, "scatterB", blades);
  const na = scatterGrass(a, seeds, tuftsPerSeed);
  const nb = scatterGrass(b, seeds, tuftsPerSeed);
  check(na === seeds.length * tuftsPerSeed && a.thinInstanceCount === na, `инстансов ровно сидов×пучков (${na})`);

  const ma = a.thinInstanceGetWorldMatrices();
  const mb = b.thinInstanceGetWorldMatrices();
  check(ma.length === na, "матрицы доступны для всех инстансов");
  check(ma.every((m, i) => m.equals(mb[i])), "раскладка детерминирована: одни входы → одни матрицы");

  let farthest = 0;
  let badScale = 0;
  ma.forEach((m, i) => {
    const t = m.getTranslation();
    const seed = seeds[Math.floor(i / tuftsPerSeed)];
    farthest = Math.max(farthest, Math.hypot(t.x - seed.x, t.z - seed.z));
    if (Math.abs(t.y) > 1e-6) badScale++;
    const sy = new Vector3(m.m[4], m.m[5], m.m[6]).length();
    if (!Number.isFinite(sy) || sy < seed.scale * 0.8 || sy > seed.scale * 1.3) badScale++;
  });
  check(farthest <= 0.34 + 1e-6, `пучок не дальше 0.34 м от своего сида (${farthest.toFixed(2)})`);
  check(badScale === 0, "пучки стоят на земле, масштаб из сида ±разброс");
  check(a.position.lengthSquared() === 0, "после раскладки база осталась в identity-трансформе");
  check(a.getBoundingInfo().boundingBox.extendSizeWorld.x > 10, "ограничивающий объём охватывает все инстансы (иначе трава мигала бы при culling)");

  check(scatterGrass(createGrassTuft(scene, "empty", blades), [], 3) === 0, "без сидов инстансов нет");
}

// --- 3. Цвет пятен луга --------------------------------------------------------
{
  let minBlueRatio = Infinity;
  let maxBlueRatio = -Infinity;
  let allSane = true;
  for (let x = -60; x < 60; x += 1.3) {
    for (let z = 0; z < 120; z += 1.7) {
      const [r, g, bl] = tuftTint(x, z, 0.5);
      if (![r, g, bl].every((c) => c > 0.55 && c < 1.4)) allSane = false;
      const ratio = bl / g;
      minBlueRatio = Math.min(minBlueRatio, ratio);
      maxBlueRatio = Math.max(maxBlueRatio, ratio);
    }
  }
  check(allSane, "множитель цвета пучка в разумных пределах");
  check(maxBlueRatio - minBlueRatio > 0.2, `на лугу есть и сочные, и выгоревшие пятна (разброс ${(maxBlueRatio - minBlueRatio).toFixed(2)})`);
  const t1 = tuftTint(3.3, 9.9, 0.2);
  const t2 = tuftTint(3.3, 9.9, 0.2);
  check(t1[0] === t2[0] && t1[1] === t2[1] && t1[2] === t2[2], "цвет детерминирован");
}

// --- 4. Интеграция: настоящий чанк ---------------------------------------------
for (const tier of ["low", "high"] as const) {
  setQualityTier(tier);
  const q = QUALITY_PROFILES[tier];
  const s2 = new Scene(engine);
  const gs = new GameState();
  const world = generateWorld(gs, 3);
  const index = new FootprintIndex(world.sections);
  const spec = world.sections.find((s) => s.grass.length > 0)!;
  const chunk = new SectionChunk(s2, spec, index);
  chunk.build(gs);

  const grass = s2.meshes.filter((m) => m.name === `grass_${spec.index}`);
  check(grass.length === 1, `${tier}: у секции один меш травы`);
  const g = grass[0];
  check(g.thinInstanceCount === spec.grass.length * q.grassTuftsPerSeed, `${tier}: пучков = сидов(${spec.grass.length}) × ${q.grassTuftsPerSeed} (${g.thinInstanceCount})`);
  check(g.isVisible && g.position.lengthSquared() === 0, `${tier}: база травы видима и в identity-трансформе`);

  const grassMat = g.material;
  chunk.dispose();
  check(!s2.meshes.some((m) => m.name.startsWith("grass_")), `${tier}: после dispose травы в сцене нет`);
  check(!!grassMat && s2.materials.includes(grassMat), `${tier}: общий материал травы не уничтожается вместе с чанком`);
  s2.dispose();
}

console.log = realLog;
scene.dispose();
if (failures > 0) {
  console.error(`\n${failures} из ${checks} проверок не прошли`);
  process.exit(1);
}
console.log(`OK: трава прошла ${checks} проверок`);
