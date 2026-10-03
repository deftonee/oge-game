/**
 * Стриминг и стены: стена не должна зависеть от того, какие секции построены сейчас.
 *
 * Опасность: секция i построена, а i+1 ещё нет. Если бы стены считались по построенным
 * чанкам, торец i выглядел бы тупиком и получил глухую стену, которая осталась бы после
 * постройки i+1. FootprintIndex строится по spec ВСЕГО мира, поэтому на стыке с
 * непостроенной соседкой стены нет (её поставит пол соседки), и «глухой» она стать не может.
 * Обратная сторона: у построенного края мира стыковая граница открыта. Это безопасно,
 * только если игрок физически не может до неё дойти до того, как стример достроит соседку.
 *
 * Тест проверяет оба утверждения на настоящем WorldStreamer:
 *  1. Игрок идёт по осям секций (маршрут через ветку A и отдельно через ветку B); после
 *     каждого шага вызывается streamer.update. Весь пол мира в радиусе REACH_M вокруг
 *     игрока обязан принадлежать ПОСТРОЕННЫМ чанкам. REACH_M с большим запасом покрывает
 *     путь игрока за кадр, включая лаг гистерезиса sectionAt.
 *  2. Для наглядности считаем, сколько «глухих» кусков стены дал бы индекс, построенный
 *     только по окну стриминга (так, как делать нельзя) — по сравнению с индексом мира.
 */
import { NullEngine, Scene } from "@babylonjs/core";
import { generateWorld } from "../src/world/WorldGenerator";
import type { SectionSpec } from "../src/world/WorldGenerator";
import { WorldStreamer } from "../src/world/WorldStreamer";
import { FootprintIndex, pointInPolygon } from "../src/world/geometry/Footprint";
import { localToWorld } from "../src/world/geometry/SectionGeometry";
import { GameState } from "../src/core/GameState";

declare const process: { exit(code?: number): never; env: Record<string, string | undefined> };

const SEEDS = Number(process.env.SEEDS ?? 5);
/** Радиус (м), в котором пол вокруг игрока обязан быть построен. */
const REACH_M = Number(process.env.REACH_M ?? 8);
const STEP_M = 2;
const PROBE_GRID = 1;

let checks = 0;
let failures = 0;
const MAX_REPORT = 15;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= MAX_REPORT) console.error(`FAIL: ${msg}`);
  }
}

const realLog = console.log;
console.log = () => {}; // стример и сборка чанков шумят

const engine = new NullEngine();
let positions = 0;
let probes = 0;
let routes = 0;
let spuriousDeadWalls = 0;
let spuriousDeadWallLen = 0;

for (let seed = 1; seed <= SEEDS; seed++) {
  const gs = new GameState();
  const world = generateWorld(gs, seed);
  for (const s of world.sections) for (const g of s.gates) gs.openGate(g.id);
  const index = new FootprintIndex(world.sections);

  // Маршруты: «через ветку A» и «через ветку B» (если развилок нет — один маршрут).
  const hasFork = world.sections.some((s) => s.forkBranch);
  const variants: Array<"a" | "b"> = hasFork ? ["a", "b"] : ["a"];

  for (const take of variants) {
    const route: SectionSpec[] = world.sections.filter((s) => !s.forkBranch || s.forkBranch === take);
    const scene = new Scene(engine);
    const streamer = new WorldStreamer(scene, world, gs);
    routes++;

    for (const spec of route) {
      for (let z = 1; z < spec.length - 0.5; z += STEP_M) {
        const q = localToWorld(spec, 0, z);
        streamer.update(q.x, q.z);
        positions++;
        const builtPieces = world.sections.filter((c) => streamer.isChunkBuilt(c)).flatMap((c) => index.piecesOf(c));

        // Пол мира в радиусе REACH_M — только из построенных чанков.
        for (let dx = -REACH_M; dx <= REACH_M; dx += PROBE_GRID) {
          for (let dz = -REACH_M; dz <= REACH_M; dz += PROBE_GRID) {
            if (dx * dx + dz * dz > REACH_M * REACH_M) continue;
            const px = q.x + dx;
            const pz = q.z + dz;
            if (!index.covers(px, pz)) continue;
            probes++;
            const builtCovers = builtPieces.some((p) => {
              const b = p.bbox;
              return px >= b.minX && px <= b.maxX && pz >= b.minZ && pz <= b.maxZ && pointInPolygon(px, pz, p.outline);
            });
            check(
              builtCovers,
              `seed ${seed} (ветка ${take}) секция ${spec.index}${spec.forkBranch ?? ""} z=${z.toFixed(1)}: пол в (${px.toFixed(1)},${pz.toFixed(1)}) в ${REACH_M} м от игрока принадлежит НЕПОСТРОЕННОЙ секции`
            );
          }
        }
      }

      // Наглядность: что дал бы индекс «только по построенным секциям» для хвоста окна.
      const built = world.sections.filter((s) => streamer.isChunkBuilt(s));
      if (built.length > 0 && spec === route[Math.floor(route.length / 2)]) {
        const windowIndex = new FootprintIndex(built);
        const frontier = built.reduce((a, b) => (b.index > a.index ? b : a));
        const full = index.wallsOf(frontier);
        const windowOnly = windowIndex.wallsOf(frontier);
        const len = (ws: readonly { a: { x: number; z: number }; b: { x: number; z: number } }[]) =>
          ws.reduce((acc, w) => acc + Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z), 0);
        const extra = len(windowOnly) - len(full);
        if (extra > 0.01) {
          spuriousDeadWalls++;
          spuriousDeadWallLen += extra;
        }
      }
    }
    scene.dispose();
  }
}

console.log = realLog;
check(positions > 50, `слишком мало позиций проверено: ${positions}`);
console.log(
  `Сидов: ${SEEDS}, маршрутов: ${routes}, позиций игрока: ${positions}, проб пола: ${probes}`
);
console.log(
  `Для сравнения: индекс «только по окну стриминга» дал бы лишнюю стену у края окна в ${spuriousDeadWalls} из ${routes} маршрутов (в сумме +${spuriousDeadWallLen.toFixed(1)} м глухой стены)`
);
console.log(`Проверок: ${checks}, провалов: ${failures}`);
if (failures > 0) {
  console.error("FAILED: рядом с игроком есть пол из непостроенной секции — открытый край может оказаться досягаем");
  process.exit(1);
}
console.log("OK: стены не зависят от окна стриминга, открытый край построенного мира недосягаем");
