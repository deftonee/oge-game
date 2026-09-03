import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  DirectionalLight,
  Vector3,
  Color4,
} from "@babylonjs/core";
import { PlayerController } from "./core/PlayerController";
import { Hud } from "./core/Hud";
import { GameState } from "./core/GameState";
import { CombatManager, DEFAULT_ROUNDS_TO_WIN } from "./combat/CombatManager";
import { LearningManager } from "./learning/LearningManager";
import { PracticeManager } from "./practice/PracticeManager";
import { GateManager } from "./gates/GateManager";
import { SpellGraphScreen } from "./ui/SpellGraphScreen";
import { generateWorld } from "./world/WorldGenerator";
import { WorldStreamer } from "./world/WorldStreamer";
import { buildTower } from "./world/Tower";
import { Bonfire } from "./entities/Bonfire";
import { Witch } from "./entities/Witch";
import { PracticeTarget } from "./entities/PracticeTarget";
import { EnergyGate } from "./entities/EnergyGate";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui-root") as HTMLElement;

const engine = new Engine(canvas, true, { stencil: true }, true);
const scene = new Scene(engine);
scene.clearColor = new Color4(0.06, 0.07, 0.12, 1);
scene.collisionsEnabled = true;

// --- Свет ---
const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
hemi.intensity = 0.85;
const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, 0.4), scene);
sun.intensity = 0.5;

// --- Прогресс игрока нужен уже на этапе генерации мира (расстановка ведьм
// с уклоном в слабо изученные темы), поэтому создаём его первым ---
const gameState = new GameState();

// --- Мир: сначала данные (сиды/позиции), затем потоковая сборка секций.
// Башня строится один раз отдельно от системы стриминга — видна всегда. ---
const world = generateWorld(gameState);
buildTower(scene, world.towerZ);
const streamer = new WorldStreamer(scene, world, gameState);

// Ведьма, от которой только что отступили/проиграли дуэль — пока игрок стоит
// рядом, бой с ней повторно не запускается. Храним именно id: при возврате
// в выгруженную секцию инстанс ведьмы пересоздаётся заново.
let cooldownWitchId: string | null = null;
// Дополнительная страховка: короткий общий кулдаун на ЛЮБУЮ новую встречу
// сразу после окончания боя. Если рядом случайно оказалась вторая ведьма
// (в паре единиц от первой), это не даст бою перезапуститься мгновенно с ней.
let elapsedTime = 0;
let encounterCooldownUntil = 0;
const GLOBAL_ENCOUNTER_COOLDOWN = 1.2; // секунд

// Баланс дуэлей: индекс секции -> сколько успешных ударов нужно игроку для
// победы. Первая секция — тренировочная, хватает одного попадания.
const ROUNDS_TO_WIN_BY_SECTION: Readonly<Record<number, number>> = { 0: 1 };

function duelRoundsToWin(): number {
  const sectionIndex = streamer.sectionIndexOf(player.position.z);
  return ROUNDS_TO_WIN_BY_SECTION[sectionIndex] ?? DEFAULT_ROUNDS_TO_WIN;
}

// --- Игрок ---
const player = new PlayerController(
  scene,
  new Vector3(world.spawnPoint.x, world.spawnPoint.y, world.spawnPoint.z)
);

// --- Камера от третьего лица (орбита мышью вокруг игрока) ---
const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.6, 9, player.position, scene);
camera.lowerBetaLimit = 0.5;
camera.upperBetaLimit = Math.PI / 2.1;
camera.lowerRadiusLimit = 4;
camera.upperRadiusLimit = 14;
camera.wheelPrecision = 40;
camera.attachControl(canvas, true);
camera.checkCollisions = false;
camera.panningSensibility = 0; // запрет панорамирования правой кнопкой

// --- HUD, бой, граф заклинаний, обучение у костра, тренировка, барьеры ---
const hud = new Hud(uiRoot, 100);
const spellGraph = new SpellGraphScreen(uiRoot, gameState);
const combat = new CombatManager(uiRoot, gameState, {
  onDuelWon: (witch) => {
    // По фидбэку: победа больше не убирает ведьму — она остаётся "дружелюбной"
    // и с ней можно спарринговать повторно по запросу (клавиша E).
    gameState.markWitchDefeated(witch.id);
    witch.setFriendly(true);
    encounterCooldownUntil = elapsedTime + GLOBAL_ENCOUNTER_COOLDOWN;
  },
  onDuelLost: (witch) => {
    cooldownWitchId = witch.id;
    encounterCooldownUntil = elapsedTime + GLOBAL_ENCOUNTER_COOLDOWN;
  },
  onRetreat: (witch) => {
    cooldownWitchId = witch.id;
    encounterCooldownUntil = elapsedTime + GLOBAL_ENCOUNTER_COOLDOWN;
  },
  onPlayerDamaged: (amount) => hud.damage(amount),
});
const learning = new LearningManager(uiRoot, gameState, {
  onSpellLearned: () => {
    // Место для будущих эффектов/звука на изучение — пока просто состояние обновилось.
  },
});
const practice = new PracticeManager(uiRoot, gameState);
const gates = new GateManager(uiRoot, gameState, {
  onGateOpened: () => {
    // Место для будущего эффекта "барьер рассеялся" — пока просто открыт в GameState.
  },
});

let nearBonfire: Bonfire | null = null;
let nearFriendlyWitch: Witch | null = null;
let nearPracticeTarget: PracticeTarget | null = null;
let nearGate: EnergyGate | null = null;

function anyMenuOpen(): boolean {
  return combat.isActive || spellGraph.isOpen || learning.isActive || practice.isActive || gates.isActive;
}

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (key === "g" && !anyMenuOpen()) {
    spellGraph.toggle();
  } else if (key === "escape") {
    if (spellGraph.isOpen) spellGraph.close();
    if (learning.isActive) learning.close();
    if (practice.isActive) practice.close();
    if (gates.isActive) gates.close();
  } else if (key === "e" && !combat.isActive && !spellGraph.isOpen) {
    if (nearGate) {
      if (gates.isActive) gates.close();
      else gates.open(nearGate);
    } else if (nearBonfire) {
      if (learning.isActive) learning.close();
      else learning.open();
    } else if (nearFriendlyWitch) {
      combat.startEncounter(nearFriendlyWitch, duelRoundsToWin());
    } else if (nearPracticeTarget) {
      if (practice.isActive) practice.close();
      else practice.open();
    }
  }
});

const ENCOUNTER_RADIUS = 2.0;
const BONFIRE_RADIUS = 2.5;
const PRACTICE_RADIUS = 2.2;
const GATE_RADIUS = 2.5;

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000;
  elapsedTime += dt;

  const menuOpen = anyMenuOpen();
  player.inputLocked = menuOpen;

  const forward = camera.getDirection(Vector3.Forward());
  const right = camera.getDirection(Vector3.Right());
  player.update(dt, forward, right);

  // Камера мягко следует за игроком
  camera.target = Vector3.Lerp(camera.target, player.position, Math.min(1, dt * 8));

  // Держим в памяти только текущую секцию и её соседей
  streamer.update(player.position.z);

  if (!menuOpen) {
    const bonfires = streamer.getActiveBonfires();
    const witches = streamer.getActiveWitches();
    const practiceTargets = streamer.getActivePracticeTargets();
    const activeGates = streamer.getActiveGates();

    // Барьеры между секциями: физически блокируют проход (коллизия),
    // разрушаются по E выбором подходящего заклинания — см. GateManager.
    nearGate = null;
    for (const gate of activeGates) {
      if (gate.opened) continue;
      if (Vector3.Distance(gate.position, player.position) <= GATE_RADIUS) {
        nearGate = gate;
        break;
      }
    }

    // Костры: игрок сам решает подойти (клавиша E), поэтому только проверяем дистанцию
    nearBonfire = null;
    if (!nearGate) {
      for (const bonfire of bonfires) {
        if (Vector3.Distance(bonfire.position, player.position) <= BONFIRE_RADIUS) {
          nearBonfire = bonfire;
          break;
        }
      }
    }

    // Ведьмы: дружелюбные (уже побеждённые) — по E на спарринг; враждебные —
    // автоматически при подходе (если тема изучена) или подсказка (если нет)
    nearFriendlyWitch = null;
    let lockedHint: string | null = null;
    if (!nearGate && !nearBonfire) {
      const cooldownActive = elapsedTime < encounterCooldownUntil;
      for (const witch of witches) {
        const dist = Vector3.Distance(witch.position, player.position);

        if (witch.friendly) {
          if (dist <= ENCOUNTER_RADIUS) {
            nearFriendlyWitch = witch;
            break;
          }
          continue;
        }

        if (cooldownActive) continue;

        if (witch.id === cooldownWitchId) {
          if (dist > ENCOUNTER_RADIUS + 0.5) cooldownWitchId = null;
          continue;
        }

        if (dist <= ENCOUNTER_RADIUS) {
          if (gameState.isLearned(witch.spell.id)) {
            combat.startEncounter(witch, duelRoundsToWin());
          } else {
            lockedHint = `🔒 Не умеешь защищаться от «${witch.spell.name}» — сначала изучи это заклинание (граф: клавиша G)`;
          }
          break;
        }
      }
    }
    hud.setLockedHint(lockedHint);

    // Объекты для практики — тоже по E, но только если рядом нет ничего важнее
    nearPracticeTarget = null;
    if (!nearGate && !nearBonfire && !nearFriendlyWitch) {
      for (const target of practiceTargets) {
        if (Vector3.Distance(target.position, player.position) <= PRACTICE_RADIUS) {
          nearPracticeTarget = target;
          break;
        }
      }
    }

    hud.setInteractHint(
      nearGate
        ? `Нажми E — барьер: нужно ${nearGate.requiredSpells} изученных тем`
        : nearBonfire
        ? "Нажми E — сесть у костра"
        : nearFriendlyWitch
        ? "Нажми E — спарринг с побеждённой ведьмой"
        : nearPracticeTarget
        ? "Нажми E — потренироваться"
        : null
    );
  } else {
    hud.setInteractHint(null);
    hud.setLockedHint(null);
  }

  scene.render();
});

window.addEventListener("resize", () => engine.resize());
