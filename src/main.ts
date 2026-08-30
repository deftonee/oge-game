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
import { CombatManager } from "./combat/CombatManager";
import { LearningManager } from "./learning/LearningManager";
import { SpellGraphScreen } from "./ui/SpellGraphScreen";
import { generateWorld } from "./world/WorldGenerator";
import { WorldStreamer } from "./world/WorldStreamer";
import { buildTower } from "./world/Tower";
import { Bonfire } from "./entities/Bonfire";

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

// --- HUD, бой, граф заклинаний, обучение у костра ---
const hud = new Hud(uiRoot, 100);
const spellGraph = new SpellGraphScreen(uiRoot, gameState);
const combat = new CombatManager(uiRoot, gameState, {
  onDuelWon: (witch) => {
    gameState.markWitchDefeated(witch.id);
    witch.dispose();
  },
  onDuelLost: (witch) => {
    // Ведьма остаётся в мире — можно вернуться и попробовать снова
    // после того, как подучишь тему или выучишь новое заклинание.
    cooldownWitchId = witch.id;
  },
  onRetreat: (witch) => {
    cooldownWitchId = witch.id;
  },
  onPlayerDamaged: (amount) => hud.damage(amount),
});
const learning = new LearningManager(uiRoot, gameState, {
  onSpellLearned: () => {
    // Место для будущих эффектов/звука на изучение — пока просто состояние обновилось.
  },
});

let nearBonfire: Bonfire | null = null;

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (key === "g" && !combat.isActive && !learning.isActive) {
    spellGraph.toggle();
  } else if (key === "escape") {
    if (spellGraph.isOpen) spellGraph.close();
    if (learning.isActive) learning.close();
  } else if (key === "e" && nearBonfire && !combat.isActive && !spellGraph.isOpen) {
    if (learning.isActive) learning.close();
    else learning.open();
  }
});

const ENCOUNTER_RADIUS = 2.0;
const BONFIRE_RADIUS = 2.5;

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000;

  const menuOpen = combat.isActive || spellGraph.isOpen || learning.isActive;
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

    // Костры: игрок сам решает подойти (клавиша E), поэтому только проверяем дистанцию
    nearBonfire = null;
    for (const bonfire of bonfires) {
      if (Vector3.Distance(bonfire.position, player.position) <= BONFIRE_RADIUS) {
        nearBonfire = bonfire;
        break;
      }
    }
    hud.setInteractHint(nearBonfire ? "Нажми E — сесть у костра" : null);

    // Ведьмы: встреча начинается автоматически при подходе
    let lockedHint: string | null = null;
    if (!nearBonfire) {
      for (const witch of witches) {
        const dist = Vector3.Distance(witch.position, player.position);

        if (witch.id === cooldownWitchId) {
          if (dist > ENCOUNTER_RADIUS + 0.5) cooldownWitchId = null;
          continue;
        }

        if (dist <= ENCOUNTER_RADIUS) {
          if (gameState.isLearned(witch.spell.id)) {
            combat.startEncounter(witch);
          } else {
            lockedHint = `🔒 Не умеешь защищаться от «${witch.spell.name}» — сначала изучи это заклинание (граф: клавиша G)`;
          }
          break;
        }
      }
    }
    hud.setLockedHint(lockedHint);
  } else {
    hud.setInteractHint(null);
    hud.setLockedHint(null);
  }

  scene.render();
});

window.addEventListener("resize", () => engine.resize());
