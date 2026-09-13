import { Vector3 } from "@babylonjs/core";
import { getSchoolById } from "../data/spells";
import { PlayerController } from "../core/PlayerController";
import { EncounterCooldown } from "../core/encounterCooldown";
import type { GameState } from "../core/GameState";
import type { WorldStreamer } from "./WorldStreamer";
import type { CombatManager } from "../combat/CombatManager";
import type { Hud } from "../core/Hud";
import type { EnergyGate } from "../entities/EnergyGate";
import type { Bonfire } from "../entities/Bonfire";
import type { Chest } from "../entities/Chest";
import type { Witch } from "../entities/Witch";
import type { PracticeTarget } from "../entities/PracticeTarget";

const ENCOUNTER_RADIUS = 2.0;
const BONFIRE_RADIUS = 2.5;
const CHEST_RADIUS = 2.2;
const PRACTICE_RADIUS = 2.2;
// Радиус подхода к барьеру: считается от ЛИНИИ барьера (по всей его ширине),
// а не от центра — иначе у широких ворот взаимодействие было бы только в середине.
const GATE_RADIUS = 2.5;

export interface ProximityDeps {
  player: PlayerController;
  streamer: WorldStreamer;
  gameState: GameState;
  combat: CombatManager;
  hud: Hud;
  cooldown: EncounterCooldown;
  duelRoundsToWin: () => number;
}

/** Квадрат расстояния от точки до линии барьера (горизонтальный сегмент width). */
function gateDistanceSq(gate: EnergyGate, x: number, z: number): number {
  const rx = Math.cos(gate.yaw); // перпендикуляр к направлению барьера
  const rz = -Math.sin(gate.yaw);
  const px = x - gate.position.x;
  const pz = z - gate.position.z;
  const half = gate.width / 2;
  const t = Math.max(-half, Math.min(half, px * rx + pz * rz));
  const dx = px - rx * t;
  const dz = pz - rz * t;
  return dx * dx + dz * dz;
}

/**
 * Детект ближайших к игроку интерактивных объектов и подсказок HUD.
 * Единственная точка, где знает про радиусы и приоритет взаимодействия:
 * ворота > костёр > дружелюбная ведьма > тренировочная цель.
 *
 * Автоматика: враждебная ведьма запускает бой сама при подходе (если тема
 * изучена) или показывает подсказку (если нет). Побеждённая — только по E.
 */
export class ProximityDetector {
  public nearGate: EnergyGate | null = null;
  public nearBonfire: Bonfire | null = null;
  public nearChest: Chest | null = null;
  public nearFriendlyWitch: Witch | null = null;
  public nearPracticeTarget: PracticeTarget | null = null;

  private isMobileActive: () => boolean = () => false;

  constructor(private deps: ProximityDeps) {}

  /**
   * Позднее связывание: mobile-контролы создаются в interaction после детекта,
   * поэтому геттер «активны ли тач-контролы» (для текста подсказок) подключается
   * отдельно, когда инстанс уже существует.
   */
  public bindMobile(getter: () => boolean): void {
    this.isMobileActive = getter;
  }

  /** Вызывается каждый кадр из render loop (menuOpen — любое меню открыто). */
  public update(menuOpen: boolean): void {
    const { player, streamer, gameState, combat, hud, cooldown } = this.deps;

    if (menuOpen) {
      this.nearGate = this.nearBonfire = this.nearChest = this.nearFriendlyWitch = this.nearPracticeTarget = null;
      hud.setInteractHint(null);
      hud.setLockedHint(null);
      return;
    }

    const bonfires = streamer.getActiveBonfires();
    const witches = streamer.getActiveWitches();
    const chests = streamer.getActiveChests();
    const practiceTargets = streamer.getActivePracticeTargets();
    const activeGates = streamer.getActiveGates();

    // Односторонние ворота развилки: как только игрок прошёл в ветку, за ним
    // включается невидимый блок — назад пути нет.
    for (const gate of activeGates) gate.updateOneWay(player.position.x, player.position.z);

    // Барьеры между секциями: физически блокируют проход (коллизия), разрушаются
    // по E выбором подходящего заклинания. Подойти можно вдоль всей ширины
    // барьера; при развилке из нескольких барьеров выбираем ближайший к игроку.
    this.nearGate = null;
    let gateDistSq = GATE_RADIUS * GATE_RADIUS;
    for (const gate of activeGates) {
      if (gate.opened) continue;
      const d = gateDistanceSq(gate, player.position.x, player.position.z);
      if (d <= gateDistSq) {
        this.nearGate = gate;
        gateDistSq = d;
      }
    }

    // Костры: игрок сам решает подойти (клавиша E), поэтому только проверяем дистанцию.
    this.nearBonfire = null;
    if (!this.nearGate) {
      for (const bonfire of bonfires) {
        if (Vector3.Distance(bonfire.position, player.position) <= BONFIRE_RADIUS) {
          this.nearBonfire = bonfire;
          break;
        }
      }
    }

    // Сундуки — быстрый пикап: открываются по E, не блокируют ничего серьёзнее.
    this.nearChest = null;
    if (!this.nearGate && !this.nearBonfire) {
      for (const chest of chests) {
        if (Vector3.Distance(chest.position, player.position) <= CHEST_RADIUS) {
          this.nearChest = chest;
          break;
        }
      }
    }

    // Ведьмы: дружелюбные (уже побеждённые) — по E на спарринг; враждебные —
    // автоматически при подходе (если тема изучена) или подсказка (если нет).
    this.nearFriendlyWitch = null;
    let lockedHint: string | null = null;
    if (!this.nearGate && !this.nearBonfire && !this.nearChest) {
      const cooldownActive = cooldown.isGlobalCooldownActive();
      for (const witch of witches) {
        const dist = Vector3.Distance(witch.position, player.position);

        if (witch.friendly) {
          if (dist <= ENCOUNTER_RADIUS) {
            this.nearFriendlyWitch = witch;
            break;
          }
          continue;
        }

        if (cooldownActive) continue;

        if (witch.id === cooldown.getCooldownWitchId()) {
          if (dist > ENCOUNTER_RADIUS + 0.5) cooldown.clearWitchCooldown();
          continue;
        }

        if (dist <= ENCOUNTER_RADIUS) {
          if (gameState.isLearned(witch.spell.id)) {
            combat.startEncounter(witch, this.deps.duelRoundsToWin());
          } else {
            const graphLabel = this.isMobileActive() ? "кнопка 📜" : "клавиша G";
            lockedHint = `🔒 Не умеешь защищаться от «${witch.spell.name}» — сначала изучи это заклинание (граф: ${graphLabel})`;
          }
          break;
        }
      }
    }
    hud.setLockedHint(lockedHint);

    // Объекты для практики — тоже по E, но только если рядом нет ничего важнее.
    this.nearPracticeTarget = null;
    if (!this.nearGate && !this.nearBonfire && !this.nearChest && !this.nearFriendlyWitch) {
      for (const target of practiceTargets) {
        if (Vector3.Distance(target.position, player.position) <= PRACTICE_RADIUS) {
          this.nearPracticeTarget = target;
          break;
        }
      }
    }

    hud.setInteractHint(this.buildInteractHint());
  }

  private buildInteractHint(): string | null {
    const key = this.isMobileActive() ? "Кнопка ✋" : "Нажми E";
    if (this.nearGate) {
      const name = this.nearGate.schoolId ? getSchoolById(this.nearGate.schoolId).name : "—";
      return `${key} — барьер ветки «${name}»: нужно ${this.nearGate.requiredSpells} изученных тем`;
    }
    if (this.nearBonfire) return `${key} — сесть у костра`;
    if (this.nearChest) return `${key} — открыть сундук`;
    if (this.nearFriendlyWitch) return `${key} — спарринг с побеждённой ведьмой`;
    if (this.nearPracticeTarget) return `${key} — потренироваться`;
    return null;
  }
}
