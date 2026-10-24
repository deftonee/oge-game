// Применение настроек к живым объектам: камера, масштаб рендера, счётчик FPS, подсказка управления,
// а также движение игрока по привязкам клавиш.
import { Window } from "happy-dom";
import { ArcRotateCamera, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { BASE_ANGULAR_SENSIBILITY, applyCameraSettings, applyRenderScale, hardwareScalingLevel } from "../src/core/applySettings";
import { PlayerController } from "../src/core/PlayerController";
import type { MovementInput } from "../src/core/PlayerController";
import { FpsCounter } from "../src/ui/FpsCounter";
import { defaultSettings } from "../src/settings/settings";
import type { ActionId } from "../src/settings/settings";
import { assignKey, describeControlsHint } from "../src/settings/bindings";
import { Hud } from "../src/core/Hud";

declare const process: { exit(code?: number): never };

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

const win = new Window({ url: "http://localhost/" });
const g = globalThis as unknown as Record<string, unknown>;
g.window = win;
g.document = win.document;

// --- камера -------------------------------------------------------------------
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera("c", 0, 1, 5, Vector3.Zero(), scene);
  check(camera.angularSensibilityX === BASE_ANGULAR_SENSIBILITY, "база совпадает с умолчанием Babylon (1000)");

  applyCameraSettings(camera, { mouseSensitivity: 1, invertY: false });
  check(camera.angularSensibilityX === 1000 && camera.angularSensibilityY === 1000, "чувствительность 1 — как раньше");
  applyCameraSettings(camera, { mouseSensitivity: 2, invertY: false });
  check(camera.angularSensibilityX === 500, "чувствительность 2 → поворот вдвое быстрее (делитель вдвое меньше)");
  applyCameraSettings(camera, { mouseSensitivity: 0.5, invertY: false });
  check(camera.angularSensibilityX === 2000, "чувствительность 0.5 → вдвое медленнее");
  applyCameraSettings(camera, { mouseSensitivity: 1, invertY: true });
  check(camera.angularSensibilityY === -1000 && camera.angularSensibilityX === 1000, "инверсия меняет знак только у вертикали");
  applyCameraSettings(camera, { mouseSensitivity: 1, invertY: false });
  check(camera.angularSensibilityY === 1000, "инверсию можно выключить обратно");

  // --- масштаб рендера -----------------------------------------------------------
  check(near(hardwareScalingLevel(1, 1), 1) && near(hardwareScalingLevel(1, 3), 1 / 3), "100 % — родное разрешение при любом DPR");
  check(near(hardwareScalingLevel(0.5, 2), 1) && near(hardwareScalingLevel(0.5, 1), 2), "50 % рисует вдвое грубее родного");
  check(near(hardwareScalingLevel(0.75, 2), 1 / 1.5), "75 % при DPR 2");
  check(near(hardwareScalingLevel(1, 0), 1) && near(hardwareScalingLevel(1, NaN), 1), "некорректный DPR не ломает (считаем 1)");
  // NullEngine игнорирует hardware scaling, поэтому проверяем на подделке с тем же интерфейсом (настоящий Engine — в браузерной проверке).
  const levels: number[] = [];
  const fakeEngine = { setHardwareScalingLevel: (l: number) => void levels.push(l) };
  applyRenderScale(fakeEngine, 0.5, 2);
  applyRenderScale(fakeEngine, 1, 2);
  check(near(levels[0], 1) && near(levels[1], 0.5), "applyRenderScale выставляет уровень движка и возвращает родное разрешение");
  scene.dispose();
}

// --- счётчик FPS ----------------------------------------------------------------
{
  win.document.body.innerHTML = "";
  const root = win.document.createElement("div") as unknown as HTMLElement;
  win.document.body.appendChild(root as unknown as Node);
  const fps = new FpsCounter(root);
  const node = root.querySelector(".hud-fps") as HTMLElement;
  check(!!node && node.style.display === "none" && !fps.isVisible, "по умолчанию счётчик скрыт");
  fps.update(60, 1);
  check(node.textContent === "", "выключенный счётчик ничего не пишет");
  fps.setVisible(true);
  fps.update(59.6, 0.016);
  check(node.style.display === "block" && node.textContent === "60 FPS", "включили — сразу показывает значение");
  fps.update(30, 0.016);
  check(node.textContent === "60 FPS", "в течение полсекунды текст не перерисовывается");
  fps.update(30, 0.5);
  check(node.textContent === "30 FPS", "через полсекунды обновляется");
  fps.setVisible(false);
  check(node.style.display === "none", "можно скрыть обратно");
  fps.dispose();
  check(root.querySelector(".hud-fps") === null, "dispose убирает элемент");
}

// --- подсказка управления ---------------------------------------------------------
{
  const d = defaultSettings().controls.bindings;
  check(describeControlsHint(d) === "WASD — движение · мышь — камера · G — граф заклинаний · E — взаимодействие рядом · Esc — пауза", "подсказка по умолчанию");
  const r = assignKey(d, "interact", 0, "KeyF");
  check(r.ok && describeControlsHint(r.bindings).includes("F — взаимодействие рядом"), "подсказка следует за переназначением");

  win.document.body.innerHTML = "";
  const root = win.document.createElement("div") as unknown as HTMLElement;
  win.document.body.appendChild(root as unknown as Node);
  const hud = new Hud(root);
  hud.setControlsHint("тест подсказки");
  check(root.querySelector(".hud-hint")!.textContent === "тест подсказки", "HUD показывает переданную подсказку");
}

// --- игрок читает движение из привязок ---------------------------------------------
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.collisionsEnabled = true;
  const down = new Set<ActionId>();
  const input: MovementInput = { isDown: (a) => down.has(a) };
  const player = new PlayerController(scene, new Vector3(0, 1, 0), input);
  const fwd = new Vector3(0, 0, 1);
  const right = new Vector3(1, 0, 0);
  const step = (): Vector3 => {
    const before = player.position.clone();
    player.update(0.1, fwd, right);
    return player.position.subtract(before);
  };
  player.position.y = 100; // чтобы гравитация не мешала проверять плоскость XZ

  check(step().length() < 1.5 && Math.abs(step().x) < 1e-9 && Math.abs(step().z) < 1e-9, "без нажатий персонаж стоит на месте (по XZ)");
  down.add("moveForward");
  const f = step();
  check(f.z > 0.5 && Math.abs(f.x) < 1e-9, "moveForward идёт вперёд (по взгляду камеры)");
  down.clear();
  down.add("moveBack");
  check(step().z < -0.5, "moveBack — назад");
  down.clear();
  down.add("moveRight");
  const rr = step();
  check(rr.x > 0.5 && Math.abs(rr.z) < 1e-9, "moveRight — вправо");
  down.clear();
  down.add("moveLeft");
  check(step().x < -0.5, "moveLeft — влево");
  down.clear();
  down.add("moveForward");
  down.add("moveBack");
  check(Math.abs(step().z) < 1e-9, "вперёд+назад гасят друг друга");
  down.clear();
  down.add("interact"); // не-движение: ничего не двигает
  check(Math.abs(step().z) < 1e-9 && Math.abs(step().x) < 1e-9, "действия не про движение игрока не двигают");
  down.add("moveForward");
  player.inputLocked = true;
  check(Math.abs(step().z) < 1e-9, "inputLocked блокирует движение");
  player.inputLocked = false;
  player.setJoystick({ x: 0, y: 1 });
  down.clear();
  check(step().z > 0.5, "мобильный стик по-прежнему работает");
  scene.dispose();
}

if (failures > 0) {
  console.error(`\n${failures} из ${checks} проверок не прошли`);
  process.exit(1);
}
console.log(`OK: применение настроек прошло ${checks} проверок`);
