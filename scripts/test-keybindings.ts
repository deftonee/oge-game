// Слой ввода по действиям (KeyBindings): раскладка, удержание, потеря фокуса, живое переназначение.
import { Window } from "happy-dom";
import { KeyBindings } from "../src/core/KeyBindings";
import { SettingsStore } from "../src/settings/SettingsStore";
import { SETTINGS_KEY } from "../src/settings/settingsStorage";
import { detectAutoTier, pickTier, readProbe } from "../src/core/quality";

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

const win = new Window({ url: "http://localhost/" });
const store = new SettingsStore({ getItem: () => null, setItem: () => {} });
const input = new KeyBindings(store, win as unknown as Window);

const press = (code: string, key = ""): void => void win.dispatchEvent(new win.KeyboardEvent("keydown", { code, key }));
const release = (code: string, key = ""): void => void win.dispatchEvent(new win.KeyboardEvent("keyup", { code, key }));

check(!input.isDown("moveForward"), "в начале ничего не нажато");
press("KeyW");
check(input.isDown("moveForward") && !input.isDown("moveBack"), "KeyW = «вперёд»");
release("KeyW");
check(!input.isDown("moveForward"), "отпустили — не нажато");

press("ArrowUp");
check(input.isDown("moveForward"), "запасная клавиша (↑) тоже работает");
press("KeyW");
release("ArrowUp");
check(input.isDown("moveForward"), "пока зажата хоть одна клавиша действия — оно активно");
release("KeyW");
check(!input.isDown("moveForward"), "обе отпущены — неактивно");

// Русская раскладка: key = «ц», но code = KeyW.
press("KeyW", "ц");
check(input.isDown("moveForward"), "русская раскладка: «ц» (KeyW) двигает вперёд");
release("KeyW", "ц");

// matches — для разовых нажатий.
check(input.matches("interact", { code: "KeyE" }) && !input.matches("interact", { code: "KeyG" }), "matches: E — взаимодействие");
check(input.matches("spellGraph", { code: "KeyG" }), "matches: G — граф");
check(input.matches("pause", { code: "Escape" }) && input.matches("pause", { code: "KeyP" }), "matches: Esc и P — пауза");
check(!input.matches("interact", { code: "" }), "пустой code (виртуальные клавиатуры) никогда не совпадает");

// Потеря фокуса не оставляет «залипших» клавиш.
press("KeyD");
check(input.isDown("moveRight"), "D зажата");
win.dispatchEvent(new win.Event("blur"));
check(!input.isDown("moveRight"), "blur сбрасывает все нажатия");

press("KeyA");
input.clearPressed();
check(!input.isDown("moveLeft"), "clearPressed забывает нажатия (при открытии меню)");

// Живое переназначение без перезапуска.
store.bindKey("interact", 0, "KeyF");
check(input.matches("interact", { code: "KeyF" }) && !input.matches("interact", { code: "KeyE" }), "после переназначения работает новая клавиша, старая — нет");
store.bindKey("moveForward", 0, "KeyZ");
press("KeyZ");
check(input.isDown("moveForward"), "переназначенное движение работает сразу");
release("KeyZ");

// События других типов и без code не ломают.
win.dispatchEvent(new win.KeyboardEvent("keydown", {}));
check(!input.isDown("moveForward"), "событие без code игнорируется");

// Выбор качества в настройках доходит до readProbe(): адрес > настройка игрока > автоопределение.
{
  (globalThis as unknown as Record<string, unknown>).window = win;
  const probeWith = (stored: object | null, url: string): string | null => {
    win.localStorage.clear();
    if (stored) win.localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
    win.happyDOM.setURL(url);
    return readProbe().override ?? null;
  };
  check(probeWith({ graphics: { quality: "low" } }, "http://localhost/") === "low", "настройка «низкое» попадает в зонд качества");
  check(probeWith({ graphics: { quality: "auto" } }, "http://localhost/") === null, "«авто» не переопределяет автоопределение");
  check(probeWith(null, "http://localhost/") === null, "без настроек — автоопределение");
  check(probeWith({ graphics: { quality: "low" } }, "http://localhost/?quality=high") === "high", "адрес сильнее сохранённой настройки");
  check(pickTier({ cores: 16, memoryGb: 8, coarsePointer: false, override: probeWith({ graphics: { quality: "low" } }, "http://localhost/") }) === "low", "настройка действительно понижает уровень на мощном устройстве");
  check(["low", "mid", "high"].includes(detectAutoTier()), "detectAutoTier даёт уровень без учёта настроек");
  win.localStorage.clear();
  win.happyDOM.setURL("http://localhost/");
}

input.dispose();
press("KeyW");
check(!input.isDown("moveForward"), "после dispose слушатели сняты");

if (failures > 0) {
  console.error(`\n${failures} из ${checks} проверок не прошли`);
  process.exit(1);
}
console.log(`OK: ввод по действиям прошёл ${checks} проверок`);
