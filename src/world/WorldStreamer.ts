import { Scene } from "@babylonjs/core";
import { SectionChunk } from "./SectionChunk";
import type { WorldSpec } from "./spec/WorldSpec";
import type { SectionSpec } from "./spec/SectionSpec";
import { distPointToSectionAxis } from "./geometry/SectionGeometry";
import { GameState } from "../core/GameState";
import { Witch } from "../entities/Witch";
import { Bonfire } from "../entities/Bonfire";
import { PracticeTarget } from "../entities/PracticeTarget";
import { Chest } from "../entities/Chest";
import { EnergyGate } from "../entities/EnergyGate";

/**
 * Держит в памяти только секцию, где сейчас игрок, и её ближайших соседей
 * (окно ±1 — чтобы не было заметного "выскакивания" геометрии на границе).
 * Остальные секции полностью разбираются; при возвращении собираются заново
 * по тем же данным (кроме уже побеждённых ведьм — см. GameState).
 *
 * Секции изогнуты (лежат не вдоль оси Z), поэтому принадлежность игрока
 * секции определяется пространственно: ближайшая к точке осевая линия.
 * frontierIndex() — самый дальний построенный индекс: за ним туман
 * (FogManager), скрывающий путь до башни.
 *
 * Переключение секции — с ГИСТЕРЕЗИСОМ (см. sectionAt): у стыка оси соседних
 * секций сходятся в одной точке, разница расстояний ~0, и без запаса любое
 * покачивание игрока вперёд-назад переключало бы индекс каждый кадр, заставляя
 * окно перестраиваться (мигание геометрии и тумана у ворот).
 */
export class WorldStreamer {
  private chunks: SectionChunk[];
  private built = new Set<number>();
  /**
   * Последний выбранный индекс («текущая секция»). Используется как состояние
   * гистерезиса: section переключается на другую секцию только когда её ось
   * стала заметно ближе (SWITCH_HYSTERESIS), а не на волоске расстояния.
   */
  private lastSectionIndex = 0;
  /**
   * Мёртвая зона переключения (метры): пока лучшая альтернатива не ближе
   * текущей секции минимум на эту величину, держим текущую. Меньше ширины
   * коридора, но заметно больше амплитуды «дребезга» игрока у границы.
   */
  private static readonly SWITCH_HYSTERESIS = 2;
  /**
   * Минимальная «глубина входа» в ветку развилки (метры по её оси), начиная
   * с которой игрок считается зашедшим в ветку. Должна быть больше зоны
   * одностороннего блока у ворот (~1 м от линии ворот): пока игрок в мёртвой
   * зоне у стыка, переключения нет, а после прохода блока вернуться нельзя —
   * переключение на ветку происходит один раз.
   */
  private static readonly FORK_ENTRY_M = 2;
  /**
   * Мягкая выгрузка обычных секций: уже построенный чанк не разбирается сразу
   * при выходе из окна стриминга (±1), а держится, пока игрок не ушёл на это
   * число индексов. Покачивание на границе двух секций (в т.ч. выход из
   * ветки развилки в схождение и обратно) перестаёт перестраивать окно и
   * откатывать туман: frontier = max построенный индекс остаётся стабильным.
   */
  private static readonly DISPOSE_MARGIN = 2;

  constructor(scene: Scene, world: WorldSpec, private gameState: GameState) {
    this.chunks = world.sections.map((s) => new SectionChunk(scene, s));
  }

  /**
   * Мировой индекс (spec.index) ближайшей к точке секции.
   *
   * ВАЖНО: возвращаем именно spec.index — генераторный индекс, а НЕ позицию
   * в массиве chunks. Окно стриминга (±1), видимость веток, frontier и туман
   * считают по spec.index, и эти две нумерации расходятся после каждой
   * развилки: ветки A/B делят индекс N+1, схождение N+2, а массив растёт на
   * 4 позиции. Возврат позиции в массиве выгружал секцию под игроком на
   * развилке №2+ (баг «мир перегенерируется возле игрока»).
   *
   * Переключение — гистерезисное (Schmitt trigger): секция становится
   * «текущей» только когда её ось оказалась заметно ближе текущей. Иначе у
   * ворот (стык осей в одной точке) покачивание игрока на ±1 м переключало
   * индекс каждый кадр и окно перестраивалось без причины.
   */
  public sectionAt(x: number, z: number): number {
    const current = this.lastSectionIndex;
    let currentDist = Infinity;
    let bestIndex = -1;
    let bestDist = Infinity;

    for (const chunk of this.chunks) {
      const s = chunk.spec;
      // Ветка развилки не может быть секцией игрока, пока он не зашёл в неё
      // РЕАЛЬНО: ось ветки начинается у САМИХ ворот родителя, поэтому стоя у
      // открытых ворот (но не войдя) игрок получает дистанцию ~0 до оси ветки,
      // и index прыгал на ветку ДО входа. Дребезг: открыл одну створку, ходишь
      // вдоль стыка между ней и закрытой — окно перестраивалось каждый кадр.
      // Ветка «занята» только когда проекция игрока на её ось ушла за порог
      // FORK_ENTRY_M (за зоной одностороннего блока ворот, ~1 м): обратно уже
      // не вернуться, переключение один раз, без дребезга.
      if (s.forkBranch) {
        const dx = s.end.x - s.start.x;
        const dz = s.end.z - s.start.z;
        const lenSq = dx * dx + dz * dz;
        if (lenSq < 1e-12) continue;
        const t = ((x - s.start.x) * dx + (z - s.start.z) * dz) / Math.sqrt(lenSq); // метры по оси ветки
        if (!this.gameState.isGateOpen(s.forkGateId ?? "") || t < WorldStreamer.FORK_ENTRY_M) continue;
      }

      const d = distPointToSectionAxis(x, z, s);
      if (s.index === current && d < currentDist) currentDist = d;
      if (d < bestDist) {
        bestDist = d;
        bestIndex = s.index;
      }
    }

    if (bestIndex < 0) return current; // пустой мир — не бывает, но страховка

    // Пока лучшая альтернатива не стала заметно ближе текущей секции
    // (currentDist - bestDist > SWITCH_HYSTERESIS), держимся за текущую:
    // реальный уход игрока даёт растущую разницу и переключение.
    if (bestIndex !== current && bestDist + WorldStreamer.SWITCH_HYSTERESIS >= currentDist) {
      return current;
    }
    this.lastSectionIndex = bestIndex;
    return bestIndex;
  }

  public update(x: number, z: number): void {
    const currentIndex = this.sectionAt(x, z);

    this.built.clear();
    const newlyBuilt: number[] = [];
    const newlyDisposed: number[] = [];
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      const spec = chunk.spec;
      const inWindow = Math.abs(spec.index - currentIndex) <= 1;

      let shouldBeBuilt: boolean;
      if (spec.forkBranch) {
        const p = spec.forkParentIndex ?? -1;
        // Ветки развилки видны, пока игрок в «зоне развилки»: родитель
        // (видны ОБА коридора), любая из веток или схождение J
        // (index от parent до parent+2). Выход из выбранной ветки в J и
        // обратно не должен выгружать «второй путь» (иначе у входа в J —
        // пустота, можно подойти к стене тумана вплотную) и не должен
        // дёргать окно: ветка построена при current=ветка и current=J
        // одинаково. Ушёл за J (current > parent+2) — ветки выгружаются
        // сразу, без мягкого буфера (позади развилки они не нужны).
        shouldBeBuilt = inWindow && currentIndex >= p && currentIndex <= p + 2;
      } else {
        // Обычные секции: мягкая выгрузка — уже построенный чанк держится
        // до DISPOSE_MARGIN индексов после выхода из окна (вперёд буфер НЕ
        // строит — только удерживает уже собранное). Покачивание на границе
        // секций (выход из ветки в схождение и обратно) больше не
        // перестраивает окно и не дёргает туман: frontier (max построенный
        // индекс) не откатывается.
        shouldBeBuilt =
          inWindow || (chunk.isBuilt && Math.abs(spec.index - currentIndex) <= WorldStreamer.DISPOSE_MARGIN);
      }

      if (shouldBeBuilt && !chunk.isBuilt) {
        chunk.build(this.gameState);
        newlyBuilt.push(spec.index);
      } else if (!shouldBeBuilt && chunk.isBuilt) {
        chunk.dispose();
        newlyDisposed.push(spec.index);
      }
      if (chunk.isBuilt) this.built.add(spec.index);
    }

    // Сводный лог кадровых переключений стримера. Печатаем только когда
    // что-то реально поменялось (построили/разобрали хоть одну секцию),
    // иначе каждый кадр спамит одно и то же.
    if (newlyBuilt.length > 0 || newlyDisposed.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[stream] player=(${x.toFixed(2)},${z.toFixed(2)}) section=${currentIndex} +build=[${newlyBuilt.join(",")}] -dispose=[${newlyDisposed.join(",")}] window=[${Array.from(this.built).sort((a, b) => a - b).join(",")}]`
      );
    }
  }

  public isBuilt(index: number): boolean {
    return this.built.has(index);
  }

  /** Построен ли конкретный чанк (ветки A/B делят один index — index API их не различает). */
  public isChunkBuilt(spec: SectionSpec): boolean {
    const chunk = this.chunks.find((c) => c.spec === spec);
    return !!chunk && chunk.isBuilt;
  }

  /** Самый дальний построенный индекс — край «отрисованного» мира, за которым туман. */
  public frontierIndex(): number {
    let best = -1;
    for (const i of this.built) if (i > best) best = i;
    return best;
  }

  /** Ведьмы не исчезают после победы (см. фидбэк) — побеждённые возвращаются
   * тут же, просто в "дружелюбном" состоянии (witch.friendly === true). */
  public getActiveWitches(): Witch[] {
    return this.collectActive((c) => c.witches);
  }

  public getActiveBonfires(): Bonfire[] {
    return this.collectActive((c) => c.bonfires);
  }

  public getActivePracticeTargets(): PracticeTarget[] {
    return this.collectActive((c) => c.practiceTargets);
  }

  public getActiveChests(): Chest[] {
    return this.collectActive((c) => c.chests);
  }

  public getActiveGates(): EnergyGate[] {
    return this.collectActive((c) => c.gates);
  }

  /** Общий сбор сущностей по всем чанкам (построенным и нет — игровой код сам фильтрует). */
  private collectActive<T>(pick: (c: SectionChunk) => readonly T[]): T[] {
    const result: T[] = [];
    for (const chunk of this.chunks) result.push(...pick(chunk));
    return result;
  }
}