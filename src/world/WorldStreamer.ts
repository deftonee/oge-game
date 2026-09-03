import { Scene } from "@babylonjs/core";
import { SectionChunk } from "./SectionChunk";
import { WorldSpec } from "./WorldGenerator";
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
 */
export class WorldStreamer {
  private chunks: SectionChunk[];

  constructor(scene: Scene, world: WorldSpec, private gameState: GameState) {
    this.chunks = world.sections.map((s) => new SectionChunk(scene, s));
  }

  /** Индекс секции, которой принадлежит мировая z-координата. */
  public sectionIndexOf(z: number): number {
    let index = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      if (z >= this.chunks[i].spec.startZ) index = i;
    }
    return index;
  }

  public update(playerZ: number): void {
    const currentIndex = this.sectionIndexOf(playerZ);

    for (let i = 0; i < this.chunks.length; i++) {
      const shouldBeBuilt = Math.abs(i - currentIndex) <= 1;
      const chunk = this.chunks[i];
      if (shouldBeBuilt && !chunk.isBuilt) chunk.build(this.gameState);
      else if (!shouldBeBuilt && chunk.isBuilt) chunk.dispose();
    }
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
    for (const chunk of this.chunks) {
      if (chunk.gate) result.push(chunk.gate);
    }
    return result;
  }
}
