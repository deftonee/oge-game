/**
 * Публичный фасад процедурной генерации мира.
 *
 * Сам генератор декомпозирован по SRP на слои (каждый — отдельный модуль):
 *   - spec/        — сериализуемая модель данных секции/мира (SectionSpec, WorldSpec);
 *   - geometry/    — чистая геометрия дуги секции (localToWorld, расстояния, сэмплинг);
 *   - math/        — детерминированный PRNG с сериализуемым состоянием + хелперы;
 *   - generation/  — константы, фабрика секций, планировщик ворот, упорядоченный
 *                    конвейер расширений (SectionAssembler + extenders) и
 *                    возобновляемый построитель трассы (TrackBuilder).
 *
 * Здесь остаются только композиция этих слоёв и два публичных входа:
 *   generateWorld() — построить мир;
 *   extendWorld()   — ПРОДЛИТЬ мир бо́льшим числом секций перед подхо́дом к башне
 *                     (если игрок не готов к финальной битве), с точностью до
 *                     снапшота генерации.
 *
 * Файл также РЕЭКСПОРТИРУЕТ типы/геометрию/константы для обратной совместимости
 * (старые импорты `from "./WorldGenerator"` продолжают работать).
 */

import type { GameState } from "../core/GameState";
import { localToWorld } from "./geometry/SectionGeometry";
import { randInt, Rng } from "./math/Rng";
import { SectionContentBuilder } from "./SectionContent";
import type { SectionSpec } from "./spec/SectionSpec";
import type { WorldSpec, TrackSnapshot } from "./spec/WorldSpec";
import { INTRO_RULES } from "./generation/WorldGenConfig";
import { GatePlanner } from "./generation/GatePlanner";
import { IdFactory, SectionAssembler } from "./generation/SectionAssembler";
import { SectionFactory } from "./generation/SectionFactory";
import { TrackBuilder, type TrackDeps, type TrackInit } from "./generation/TrackBuilder";
import { logWorldSpec } from "./generation/WorldLogger";
import { ContentExtender } from "./generation/extenders/ContentExtender";
import { SideSpurExtender } from "./generation/extenders/SideSpurExtender";

/**
 * Собирает подсистемы генерации над общим rng/id-потоком. Порядок регистрации
 * расширений задаёт порядок наполнения секции: content (сущности+декор), затем
 * side-spurs (вырезают проём в уже готовом бордюре).
 */
function createGeneration(gameState: GameState, rng: Rng, ids: IdFactory): { deps: TrackDeps } {
  const rand = rng.fn;
  const contentBuilder = new SectionContentBuilder(rand, gameState, () => ids.nextWitch(), () => ids.nextChest());
  const assembler = new SectionAssembler()
    .use(new ContentExtender(contentBuilder, INTRO_RULES))
    .use(new SideSpurExtender(contentBuilder));
  const factory = new SectionFactory(rand);
  const gatePlanner = new GatePlanner(rand, gameState);
  return { deps: { rng, gameState, ids, factory, gatePlanner, assembler, contentBuilder } };
}

/** Достроить подход к башне и собрать финальный WorldSpec (снапшот — до подхода). */
function assembleWorld(track: TrackBuilder, combatSections: SectionSpec[], snapshot: TrackSnapshot): WorldSpec {
  const approach = track.buildApproach();
  const sections = [...combatSections, approach];
  const spawnLocal = localToWorld(sections[0], 0, 2.5);
  const towerLocal = localToWorld(approach, 0, approach.length + 2);
  return {
    sections,
    spawnPoint: { x: spawnLocal.x, y: 1, z: spawnLocal.z },
    tower: { x: towerLocal.x, z: towerLocal.z },
    track: snapshot,
  };
}

/**
 * Процедурная генерация коридора: каждый запуск с новым seed даёт другое число и
 * длину секций, другую расстановку ведьм и декора.
 *
 * - Первая секция — узкий шлюз БЕЗ ведьм: мягкий вход.
 * - Остальные в 3 раза шире/длиннее, трасса плавно изгибается (постоянная
 *   кривизна вдоль секции — стыки без излома).
 * - Иногда секция заканчивается ДВУМЯ воротами-развилкой на разные ветки
 *   прокачки; тематика ворот = школа, выбирается по «наименее отработанных».
 * - Финал — спокойный подход к башне.
 */
export function generateWorld(gameState: GameState, seed: number = Date.now()): WorldSpec {
  const rng = new Rng(seed);
  const ids = new IdFactory();
  const { deps } = createGeneration(gameState, rng, ids);

  const mainSectionCount = randInt(rng.fn, 5, 7);
  const init: TrackInit = {
    seed,
    mainSectionCount,
    cursor: { x: 0, z: 0 },
    yaw: 0,
    specIndex: 0,
    worldCount: 0,
    prevSpec: null,
  };
  const track = new TrackBuilder(deps, init);

  const combat: SectionSpec[] = [];
  while (track.hasMoreTrunks()) {
    combat.push(...track.appendSection());
  }

  const snapshot = track.snapshot();
  const world = assembleWorld(track, combat, snapshot);
  logWorldSpec(world, seed);
  return world;
}

/**
 * ПРОДЛИТЬ мир: добавить ещё `extraSections` боевых секций ПЕРЕД подхо́дом к
 * башне. Генерация возобновляется с сохранённого снапшота (курсор/курс/индексы/
 * счётчики/PRNG) — старый подход отбрасывается, новый строится после добавленных
 * секций. Ничего не делает, если мира нельзя продлить (нет снапшота) или
 * extraSections <= 0.
 *
 * Игровой код применяет это, когда игрок «не готов к финальной битве»: заменяет
 * текущий WorldSpec продлённым (новый поток стриминга строится по новому массиву).
 */
export function extendWorld(world: WorldSpec, gameState: GameState, extraSections: number): WorldSpec {
  const snap = world.track;
  if (!snap || extraSections <= 0) return world;

  const rng = Rng.fromState(snap.rngState);
  const ids = IdFactory.fromSnapshot(snap.ids);
  const { deps } = createGeneration(gameState, rng, ids);
  deps.gatePlanner.restore(snap.gateSchoolUsage);

  const combat = world.sections.filter((s) => s.tier !== 0);
  // Последняя боевая секция базового мира несла барьер ПОДХОДА (gate-approach) —
  // в продлённом мире она снова середина трассы, поэтому снимаем барьер подхода
  // и назначаем обычный выходной (иначе на стыке оказались бы два gate-approach,
  // а проход в добавленные секции остался бы без барьера).
  const lastCombat = combat[combat.length - 1] ?? null;
  if (lastCombat) deps.gatePlanner.assignExitGates(lastCombat, false);

  const track = new TrackBuilder(deps, {
    seed: snap.seed,
    mainSectionCount: snap.mainSectionCount,
    cursor: snap.cursor,
    yaw: snap.yaw,
    specIndex: snap.specIndex,
    worldCount: snap.worldCount,
    prevSpec: lastCombat,
  });

  const extended: SectionSpec[] = [...combat];
  for (let i = 0; i < extraSections; i++) extended.push(...track.appendSection());

  const snapshot = track.snapshot();
  const result = assembleWorld(track, extended, snapshot);
  logWorldSpec(result, snap.seed);
  return result;
}

// --- Публичный API (реэкспорт для обратной совместимости старых импортов) ---

export type {
  WitchSpec,
  BonfireSpec,
  ScatterSeed,
  PracticeTargetKind,
  PracticeTargetSpec,
  ChestSpec,
  SideSpurSpec,
  GateSpec,
  BorderStyle,
  SectionSpec,
} from "./spec/SectionSpec";
export type { WorldSpec, TrackSnapshot, IdCounters } from "./spec/WorldSpec";
export type { Vec2, ArcFrame, AxialFrame } from "./geometry/SectionGeometry";
export type { RandomFn } from "./math/Rng";
export {
  yawAt,
  localToWorld,
  distPointToSegment,
  distPointToSectionAxis,
  clamp,
  normAngle,
  sampleAxisPath,
  sampleBorderPath,
} from "./geometry/SectionGeometry";
export { Rng, mulberry32, randRange, randInt, pick, randSign, chance } from "./math/Rng";
export * from "./generation/WorldGenConfig";
