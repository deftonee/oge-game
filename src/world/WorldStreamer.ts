import { Scene } from "@babylonjs/core";
import { SectionChunk } from "./SectionChunk";
import { WorldSpec, SectionSpec, distPointToSegment } from "./WorldGenerator";
import { GameState } from "../core/GameState";
import { Witch } from "../entities/Witch";
import { Bonfire } from "../entities/Bonfire";
import { PracticeTarget } from "../entities/PracticeTarget";
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
 */
export class WorldStreamer {
  private chunks: SectionChunk[];
  private built = new Set<number>();
  /**
   * Последний выбранный индекс. Нужен как ти-брейк при ПАРИТЕТЕ дистанций:
   * ось схождения J строится на продолжении оси родителя (jStart = cursor +
   * dir*branchLen), поэтому на перекрытом участке [branchLen, parent.length]
   * расстояния до обеих осей тождественно равны и sectionAt дрожит между
   * ними, выгружая секцию под игроком. При |d1 - d2| < TIE_EPS держимся за
   * текущую секцию; реальный уход даёт растущую разницу и переключение.
   */
  private lastSectionIndex = 0;
  private static readonly TIE_EPS = 0.25;

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
   */
  public sectionAt(x: number, z: number): number {
    let bestDist = Infinity;
    const candidates: SectionSpec[] = [];
    for (const chunk of this.chunks) {
      const s = chunk.spec;
      const d = distPointToSegment(x, z, s.start.x, s.start.z, s.end.x, s.end.z);
      if (d < bestDist - WorldStreamer.TIE_EPS) {
        bestDist = d;
        candidates.length = 0;
        candidates.push(s);
      } else if (Math.abs(d - bestDist) <= WorldStreamer.TIE_EPS) {
        candidates.push(s);
      }
    }
    // При паритете (совпадающие оси родителя и схождения J) держимся за
    // текущую секцию; если её нет среди кандидатов — выбираем ближайшую
    // ВПЕРЁД по индексу (не откатываемся назад, иначе frontier/туман прыгают).
    let chosen = candidates.find((s) => s.index === this.lastSectionIndex);
    if (!chosen) {
      const forward = candidates.filter((s) => s.index > this.lastSectionIndex);
      chosen =
        forward.length > 0
          ? forward.reduce((a, b) => (b.index < a.index ? b : a))
          : candidates.reduce((a, b) => (b.index > a.index ? b : a));
    }
    this.lastSectionIndex = chosen.index;
    return chosen.index;
  }

  public update(x: number, z: number): void {
    const currentIndex = this.sectionAt(x, z);

    this.built.clear();
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      const spec = chunk.spec;
      const inWindow = Math.abs(spec.index - currentIndex) <= 1;

      // Ветки развилки (forkBranch): строятся, пока игрок стоит у развилки
      // (видно ОБА параллельных коридора), либо когда выбрал эту ветку
      // (ворота открыты) — невыбранная ветка больше не прорисовывается.
      let shouldBeBuilt = inWindow;
      if (spec.forkBranch) {
        const chosen = this.gameState.isGateOpen(spec.forkGateId ?? "");
        shouldBeBuilt = inWindow && (chosen || currentIndex === (spec.forkParentIndex ?? -1));
      }

      if (shouldBeBuilt && !chunk.isBuilt) chunk.build(this.gameState);
      else if (!shouldBeBuilt && chunk.isBuilt) chunk.dispose();
      if (chunk.isBuilt) this.built.add(spec.index);
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
    const result: Witch[] = [];
    for (const chunk of this.chunks) result.push(...chunk.witches);
    return result;
  }

  public getActiveBonfires(): Bonfire[] {
    const result: Bonfire[] = [];
    for (const chunk of this.chunks) result.push(...chunk.bonfires);
    return result;
  }

  public getActivePracticeTargets(): PracticeTarget[] {
    const result: PracticeTarget[] = [];
    for (const chunk of this.chunks) result.push(...chunk.practiceTargets);
    return result;
  }

  public getActiveGates(): EnergyGate[] {
    const result: EnergyGate[] = [];
    for (const chunk of this.chunks) result.push(...chunk.gates);
    return result;
  }
}