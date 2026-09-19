import type { SectionSpec } from "./SectionSpec";
import type { Vec2 } from "../geometry/SectionGeometry";

/** Итоговое описание мира: секции + точка спавна игрока + позиция башни. */
export interface WorldSpec {
  sections: SectionSpec[];
  spawnPoint: { x: number; y: number; z: number };
  tower: { x: number; z: number };
  /**
   * Снапшот состояния генерации (курсор, курс, счётчики, PRNG, распределение
   * школ по гейтам) на момент ПОСЛЕ последней боевой секции (перед подходом к
   * башне). Нужен, чтобы ПРОДЛИТЬ мир секциями, если игрок не готов к финальной
   * битве — см. extendWorld(): генерация трассы возобновляется с этого снапшота
   * и добавляет ещё N боевых секций перед подхо́дом.
   *
   * Отсутствует у миров, собранных не генератором (ручные секции/тесты).
   */
  track?: TrackSnapshot;
}

/** Счётчики генераторов id (глобальные в пределах одного мира — для уникальности). */
export interface IdCounters {
  witch: number;
  chest: number;
  spur: number;
}

/**
 * Сериализуемое продолжение трассы. Курсор/курс/индексы позволяют возобновить
 * TrackBuilder с точностью до PRNG-состояния; prngState делает продление
 * детерминированным (тот же снапшот → те же новые секции).
 */
export interface TrackSnapshot {
  seed: number;
  rngState: number;
  cursor: Vec2;
  yaw: number;
  /** Следующий свободный генераторный индекс секции (index подхода к башне). */
  specIndex: number;
  /** Сколько стволовых позиций уже выпущено (влияет на tier последующих секций). */
  worldCount: number;
  mainSectionCount: number;
  ids: IdCounters;
  /** Сколько раз каждая школа назначалась воротами (анти-повтор внутри прогона). */
  gateSchoolUsage: Record<string, number>;
}
