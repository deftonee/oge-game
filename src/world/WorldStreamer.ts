import { Scene } from "@babylonjs/core";
import { SectionChunk } from "./SectionChunk";
import { WorldSpec } from "./WorldGenerator";
import { GameState } from "../core/GameState";
import { Witch } from "../entities/Witch";
import { Bonfire } from "../entities/Bonfire";

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

  public update(playerZ: number): void {
    let currentIndex = 0;
    for (let i = 0; i < this.chunks.length; i++) {
      if (playerZ >= this.chunks[i].spec.startZ) currentIndex = i;
    }

    for (let i = 0; i < this.chunks.length; i++) {
      const shouldBeBuilt = Math.abs(i - currentIndex) <= 1;
      const chunk = this.chunks[i];
      if (shouldBeBuilt && !chunk.isBuilt) chunk.build(this.gameState);
      else if (!shouldBeBuilt && chunk.isBuilt) chunk.dispose();
    }
  }

  /** Побеждённые ведьмы отфильтровываются и здесь — на случай, если их чанк
   * ещё не успел пересобраться после победы в текущей секции. */
  public getActiveWitches(): Witch[] {
    const result: Witch[] = [];
    for (const chunk of this.chunks) {
      for (const witch of chunk.witches) {
        if (!this.gameState.isWitchDefeated(witch.id)) result.push(witch);
      }
    }
    return result;
  }

  public getActiveBonfires(): Bonfire[] {
    const result: Bonfire[] = [];
    for (const chunk of this.chunks) result.push(...chunk.bonfires);
    return result;
  }
}
