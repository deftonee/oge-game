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
import { FogManager } from "./world/FogManager";
import { Bonfire } from "./entities/Bonfire";
import { Witch } from "./entities/Witch";
import { PracticeTarget } from "./entities/PracticeTarget";
import { EnergyGate } from "./entities/EnergyGate";
import { getSchoolById } from "./data/spells";
import { MobileControls } from "./mobile/MobileControls";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui-root") as HTMLElement;

const engine = new Engine(canvas, true, { stencil: true }, true);

// --- Эмуляция мобильного устройства на десктопе (dev-only, ?mobile=1) ---
// Для быстрой разработки без телефона: открываем http://localhost:5173/?mobile=1 —
// окно сжимается до портретных пропорций 9:16, мобильное управление включается
// принудительно (стик и кнопки работают мышью). В проде ветка выкидывается.
const emulateMobile = import.meta.env.DEV && new URLSearchParams(window.location.search).has("mobile");
if (emulateMobile) {
  document.body.classList.add("emulate-mobile");
  // Канвас CSS-сжимается до 9:16 — следим за его размером и пересобираем буфер
  new ResizeObserver(() => engine.resize()).observe(canvas);
}

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
buildTower(scene, world.tower.x, world.tower.z);
const streamer = new WorldStreamer(scene, world, gameState);
// Туман на frontier отрисованных секций скрывает участок до башни.
const fog = new FogManager(scene, world);

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
  const sectionIndex = streamer.sectionAt(player.position.x, player.position.z);
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

/** Общая логика клавиши E и мобильной кнопки «взаимодействие». */
function handleInteract(): void {
  if (combat.isActive || spellGraph.isOpen) return;
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

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (key === "g" && !anyMenuOpen()) {
    spellGraph.toggle();
  } else if (key === "escape") {
    if (spellGraph.isOpen) spellGraph.close();
    if (learning.isActive) learning.close();
    if (practice.isActive) practice.close();
    if (gates.isActive) gates.close();
  } else if (key === "e") {
    handleInteract();
  }
});

// Мобильное управление: стик слева, кнопки справа. Монтируется при первом касании,
// на тач-устройствах — сразу; force (эмуляция с компа) включает без касаний.
const mobile = new MobileControls({
  onInteract: () => handleInteract(),
  onSpellGraph: () => {
    if (!anyMenuOpen() && !spellGraph.isOpen) spellGraph.toggle();
  },
  force: emulateMobile,
});

const ENCOUNTER_RADIUS = 2.0;
const BONFIRE_RADIUS = 2.5;
const PRACTICE_RADIUS = 2.2;
// Радиус подхода к барьеру: считается от линии барьера (по всей его ширине),
// а не от центра — иначе у широких ворот ветки взаимодействие было бы только в середине.
const GATE_RADIUS = 2.5;

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

engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000;
  elapsedTime += dt;

  const menuOpen = anyMenuOpen();
  player.inputLocked = menuOpen;

  // Мобильное управление: прячем во время меню, вектор стика отдаём кадр в кадр
  mobile.setVisible(!menuOpen);
  player.setJoystick(mobile.getMoveVector());

  const forward = camera.getDirection(Vector3.Forward());
  const right = camera.getDirection(Vector3.Right());
  player.update(dt, forward, right);

  // Камера мягко следует за игроком
  camera.target = Vector3.Lerp(camera.target, player.position, Math.min(1, dt * 8));

  // Держим в памяти только текущую секцию и её соседей; туман прячет
  // неотрисованный участок до башни
  streamer.update(player.position.x, player.position.z);
  fog.update(streamer.frontierIndex(), dt);

  if (!menuOpen) {
    const bonfires = streamer.getActiveBonfires();
    const witches = streamer.getActiveWitches();
    const practiceTargets = streamer.getActivePracticeTargets();
    const activeGates = streamer.getActiveGates();

    // Односторонние ворота развилки: как только игрок прошёл в ветку,
    // за ним включается невидимый блок — назад пути нет.
    for (const gate of activeGates) gate.updateOneWay(player.position.x, player.position.z);

    // Барьеры между секциями: физически блокируют проход (коллизия),
    // разрушаются по E выбором подходящего заклинания — см. GateManager.
    // Подойти можно вдоль всей ширины барьера; при развилке из нескольких
    // барьеров выбираем ближайший к игроку.
    nearGate = null;
    let gateDistSq = GATE_RADIUS * GATE_RADIUS;
    for (const gate of activeGates) {
      if (gate.opened) continue;
      const d = gateDistanceSq(gate, player.position.x, player.position.z);
      if (d <= gateDistSq) {
        nearGate = gate;
        gateDistSq = d;
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
            const graphLabel = mobile.isActive ? "кнопка 📜" : "клавиша G";
            lockedHint = `🔒 Не умеешь защищаться от «${witch.spell.name}» — сначала изучи это заклинание (граф: ${graphLabel})`;
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
        ? (mobile.isActive ? "Кнопка ✋" : "Нажми E") +
            " — барьер ветки «" +
            (nearGate.schoolId ? getSchoolById(nearGate.schoolId).name : "—") +
            `»: нужно ${nearGate.requiredSpells} изученных тем`
        : nearBonfire
        ? (mobile.isActive ? "Кнопка ✋" : "Нажми E") + " — сесть у костра"
        : nearFriendlyWitch
        ? (mobile.isActive ? "Кнопка ✋" : "Нажми E") + " — спарринг с побеждённой ведьмой"
        : nearPracticeTarget
        ? (mobile.isActive ? "Кнопка ✋" : "Нажми E") + " — потренироваться"
        : null
    );
  } else {
    hud.setInteractHint(null);
    hud.setLockedHint(null);
  }

  scene.render();
});

window.addEventListener("resize", () => engine.resize());
