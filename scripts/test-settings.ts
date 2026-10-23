// Настройки: валидация, хранилище (в т.ч. сломанное), SettingsStore и правила переназначения клавиш.
import {
  ACTIONS,
  DEFAULT_BINDINGS,
  MOUSE_SENSITIVITY_MAX,
  MOUSE_SENSITIVITY_MIN,
  RENDER_SCALES,
  defaultSettings,
  sanitizeSettings,
} from "../src/settings/settings";
import type { Bindings, Settings } from "../src/settings/settings";
import { ACTION_LABELS, RESERVED_CODES, assignKey, clearKey, describeKeys, findBinding, keyLabel, resetBindings } from "../src/settings/bindings";
import { SETTINGS_KEY, loadSettings, saveSettings } from "../src/settings/settingsStorage";
import type { KeyValueStorage } from "../src/settings/settingsStorage";
import { SettingsStore, boundActions } from "../src/settings/SettingsStore";

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

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}
const allCodes = (b: Bindings): string[] => ACTIONS.flatMap((a) => b[a]).filter((k): k is string => k !== null);

// --- значения по умолчанию ------------------------------------------------------
{
  const d = defaultSettings();
  check(d.graphics.quality === "auto" && d.graphics.renderScale === 1 && d.graphics.showFps === false, "графика по умолчанию: авто, 100 %, без FPS");
  check(d.controls.mouseSensitivity === 1 && d.controls.invertY === false, "управление по умолчанию: чувствительность 1, без инверсии");
  check(ACTIONS.every((a) => d.controls.bindings[a][0] === DEFAULT_BINDINGS[a][0]), "у каждого действия есть основная клавиша");
  const codes = allCodes(d.controls.bindings);
  check(new Set(codes).size === codes.length, "в раскладке по умолчанию нет конфликтов клавиш");
  check(d.controls.bindings.pause[0] === "Escape" && d.controls.bindings.pause[1] === "KeyP", "пауза: Esc и P");
  check(defaultSettings() !== defaultSettings() && defaultSettings().controls.bindings !== defaultSettings().controls.bindings, "каждый вызов отдаёт свежую копию (без общего состояния)");
  check(ACTIONS.every((a) => !!ACTION_LABELS[a]), "у каждого действия есть подпись");
}

// --- sanitize -------------------------------------------------------------------
{
  check(JSON.stringify(sanitizeSettings(null)) === JSON.stringify(defaultSettings()), "null → настройки по умолчанию");
  check(JSON.stringify(sanitizeSettings("мусор")) === JSON.stringify(defaultSettings()), "строка → настройки по умолчанию");
  check(JSON.stringify(sanitizeSettings([1, 2])) === JSON.stringify(defaultSettings()), "массив → настройки по умолчанию");

  const s = sanitizeSettings({
    graphics: { quality: "ultra", renderScale: 0.6, showFps: "yes" },
    controls: { mouseSensitivity: 99, invertY: 1, bindings: { interact: ["KeyF"], moveForward: "oops" } },
    extra: { evil: true },
  });
  check(s.graphics.quality === "auto" && s.graphics.renderScale === 1 && s.graphics.showFps === false, "недопустимая графика заменяется значениями по умолчанию");
  check(s.controls.mouseSensitivity === MOUSE_SENSITIVITY_MAX, "чувствительность зажимается сверху");
  check(s.controls.invertY === false, "не-boolean заменяется по умолчанию");
  check(s.controls.bindings.interact[0] === "KeyF" && s.controls.bindings.interact[1] === null, "корректная привязка сохраняется");
  check(s.controls.bindings.moveForward[0] === "KeyW", "битая привязка → по умолчанию");
  check(!("extra" in s), "лишние поля отбрасываются");

  check(sanitizeSettings({ controls: { mouseSensitivity: 0 } }).controls.mouseSensitivity === MOUSE_SENSITIVITY_MIN, "чувствительность зажимается снизу");
  check(sanitizeSettings({ controls: { mouseSensitivity: NaN } }).controls.mouseSensitivity === 1, "NaN → 1");
  check(sanitizeSettings({ controls: { mouseSensitivity: 1.23456 } }).controls.mouseSensitivity === 1.23, "чувствительность округляется до сотых");
  check(RENDER_SCALES.every((r) => sanitizeSettings({ graphics: { renderScale: r } }).graphics.renderScale === r), "допустимые масштабы рендера принимаются");

  const dup = sanitizeSettings({ controls: { bindings: { moveForward: ["KeyX", null], moveBack: ["KeyX", "KeyZ"] } } });
  check(dup.controls.bindings.moveForward[0] === "KeyX" && dup.controls.bindings.moveBack[0] === "KeyZ", "клавиша, занятая ранним действием, отбрасывается у позднего");
  const injected = sanitizeSettings({ controls: { bindings: { interact: ["<script>", "Key E"] } } });
  check(injected.controls.bindings.interact[0] === "KeyE", "клавиша с недопустимыми символами отвергается");
  const long = sanitizeSettings({ controls: { bindings: { interact: ["A".repeat(50), null] } } });
  check(long.controls.bindings.interact[0] === "KeyE", "слишком длинное имя клавиши отвергается");
  const onlySecondary = sanitizeSettings({ controls: { bindings: { interact: [null, "KeyF"] } } });
  check(onlySecondary.controls.bindings.interact[0] === "KeyF" && onlySecondary.controls.bindings.interact[1] === null, "только запасная клавиша становится основной");
  const idem = sanitizeSettings(s);
  check(JSON.stringify(idem) === JSON.stringify(s), "sanitize идемпотентна");
}

// --- хранилище ------------------------------------------------------------------
{
  const st = memoryStorage();
  check(JSON.stringify(loadSettings(st)) === JSON.stringify(defaultSettings()), "пустое хранилище → настройки по умолчанию");
  const custom: Settings = { ...defaultSettings(), graphics: { quality: "low", renderScale: 0.75, showFps: true } };
  check(saveSettings(custom, st) === true && !!st.data[SETTINGS_KEY], "сохранение пишет под ключом версии");
  check(loadSettings(st).graphics.quality === "low" && loadSettings(st).graphics.renderScale === 0.75, "сохранённое читается обратно");

  check(loadSettings(memoryStorage({ [SETTINGS_KEY]: "{не json" })).graphics.quality === "auto", "битый JSON не ломает игру");
  check(loadSettings(memoryStorage({ [SETTINGS_KEY]: '{"graphics":{"quality":"high"}}' })).graphics.quality === "high", "частичные данные дополняются по умолчанию");

  const throwing: KeyValueStorage = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  check(loadSettings(throwing).graphics.quality === "auto", "хранилище, бросающее на чтении → по умолчанию");
  check(saveSettings(defaultSettings(), throwing) === false, "хранилище, бросающее на записи → false, без исключения");
  check(saveSettings(defaultSettings(), null) === false && loadSettings(null).graphics.quality === "auto", "без хранилища всё работает в памяти");
}

// --- SettingsStore ---------------------------------------------------------------
{
  const st = memoryStorage();
  const store = new SettingsStore(st);
  let notified = 0;
  let last: Readonly<Settings> | null = null;
  const unsub = store.subscribe((s) => {
    notified++;
    last = s;
  });

  store.setGraphics({ quality: "low" });
  check(notified === 1 && last!.graphics.quality === "low" && store.get().graphics.quality === "low", "setGraphics уведомляет подписчиков");
  check(JSON.parse(st.data[SETTINGS_KEY]).graphics.quality === "low", "изменение сразу сохраняется");
  check(new SettingsStore(st).get().graphics.quality === "low", "новый запуск видит сохранённое");

  store.setControls({ mouseSensitivity: 50, invertY: true });
  check(store.get().controls.mouseSensitivity === MOUSE_SENSITIVITY_MAX && store.get().controls.invertY === true, "setControls зажимает чувствительность");

  const before = JSON.stringify(store.get().controls.bindings);
  const bad = store.bindKey("interact", 0, "Escape");
  check(!bad.ok && JSON.stringify(store.get().controls.bindings) === before, "отказ не меняет настройки");
  const n = notified;
  store.unbindKey("interact", 0);
  check(notified === n, "отказ не уведомляет подписчиков");

  check(store.bindKey("interact", 0, "KeyF").ok && store.get().controls.bindings.interact[0] === "KeyF", "bindKey назначает клавишу");
  store.resetBindings();
  check(store.get().controls.bindings.interact[0] === "KeyE" && store.get().controls.invertY === true, "resetBindings сбрасывает только клавиши");
  store.resetAll();
  check(JSON.stringify(store.get()) === JSON.stringify(defaultSettings()), "resetAll возвращает всё по умолчанию");
  unsub();
  const n2 = notified;
  store.setGraphics({ showFps: true });
  check(notified === n2, "после unsubscribe уведомлений нет");
  check(boundActions(store.get()).length === ACTIONS.length, "boundActions: у всех действий есть клавиша");

  const broken = new SettingsStore({ getItem: () => null, setItem: () => { throw new Error("quota"); } });
  broken.setGraphics({ renderScale: 0.5 });
  check(broken.get().graphics.renderScale === 0.5, "если сохранить нельзя — настройка всё равно действует в этой сессии");
}

// --- правила переназначения -------------------------------------------------------
{
  const base = defaultSettings().controls.bindings;
  const r1 = assignKey(base, "interact", 0, "KeyF");
  check(r1.ok && r1.bindings.interact[0] === "KeyF" && base.interact[0] === "KeyE", "assignKey возвращает новый объект, исходный не меняется");

  const reserved = assignKey(base, "interact", 0, "Escape");
  check(!reserved.ok && reserved.reason === "reserved", "Esc зарезервирован");
  check(RESERVED_CODES.includes("Backquote") && !assignKey(base, "interact", 0, "Backquote").ok, "Backquote (отладчик) зарезервирован");
  check(assignKey(base, "pause", 0, "Escape").ok, "у «паузы» Esc остаётся законной привязкой");

  // Ловушка: заменили Esc у паузы — вернуть его обратно должно быть можно (не только сбросом всего управления).
  const swapped = assignKey(base, "pause", 0, "KeyU");
  check(swapped.ok && swapped.bindings.pause[0] === "KeyU" && !swapped.bindings.pause.includes("Escape"), "Esc заменён у паузы на U");
  if (swapped.ok) {
    const back0 = assignKey(swapped.bindings, "pause", 0, "Escape");
    check(back0.ok && back0.bindings.pause[0] === "Escape", "Esc можно вернуть паузе в основной слот");
    const back1 = assignKey(swapped.bindings, "pause", 1, "Escape");
    check(back1.ok && JSON.stringify(back1.bindings.pause) === JSON.stringify(["KeyU", "Escape"]), "Esc можно вернуть паузе и в запасной слот");
    const stillReserved = assignKey(swapped.bindings, "interact", 0, "Escape");
    check(!stillReserved.ok && stillReserved.reason === "reserved", "другим действиям Esc по-прежнему нельзя");
    const backquote = assignKey(swapped.bindings, "pause", 1, "Backquote");
    check(!backquote.ok && backquote.reason === "reserved", "Backquote (отладчик) нельзя и паузе");
  }

  // Забрать клавишу у действия, у которого есть другая: хозяин теряет её, но сохраняет вторую.
  const steal = assignKey(base, "interact", 0, "ArrowUp");
  check(steal.ok && steal.bindings.interact[0] === "ArrowUp" && steal.bindings.moveForward[0] === "KeyW" && steal.bindings.moveForward[1] === null, "клавиша забирается у действия с запасной клавишей");

  // Последняя клавиша хозяина → обмен.
  const swap = assignKey(base, "moveForward", 0, "KeyE");
  check(swap.ok && swap.bindings.moveForward[0] === "KeyE" && swap.bindings.interact[0] === "KeyW", "последняя клавиша хозяина: происходит обмен");
  // Нечем обмениваться → отказ.
  const swapSlot = assignKey(base, "moveForward", 1, "KeyE");
  check(swapSlot.ok === true && swapSlot.bindings.interact[0] === "ArrowUp", "обмен через запасной слот: прежняя клавиша слота (↑) уходит хозяину");
  const empty = assignKey(base, "interact", 1, "KeyG");
  check(!empty.ok && empty.reason === "needs-key", "забрать единственную клавишу в пустой слот нечем обменять — отказ");

  // Та же клавиша в другой слот того же действия.
  const move = assignKey(base, "moveForward", 1, "KeyW");
  check(move.ok && move.bindings.moveForward[0] === null === false && move.bindings.moveForward.filter((k) => k === "KeyW").length === 1, "перенос внутри действия не дублирует клавишу");

  // Инвариант: после ЛЮБОЙ последовательности назначений нет конфликтов и у каждого действия есть основная.
  let b = base;
  const seq: Array<[number, number, string]> = [];
  const codes = ["KeyA", "KeyQ", "KeyW", "KeyE", "KeyR", "ArrowUp", "KeyP", "Space", "KeyG", "ArrowLeft"];
  for (let i = 0; i < 400; i++) seq.push([i * 7 % ACTIONS.length, i % 2, codes[(i * 13 + 5) % codes.length]]);
  let invariantHolds = true;
  for (const [ai, slot, code] of seq) {
    const res = assignKey(b, ACTIONS[ai], slot as 0 | 1, code);
    if (res.ok) b = res.bindings;
    const used = allCodes(b);
    if (new Set(used).size !== used.length || ACTIONS.some((a) => b[a][0] === null)) invariantHolds = false;
  }
  check(invariantHolds, "400 случайных назначений: нет конфликтов, у каждого действия есть основная клавиша");

  const cl = clearKey(base, "moveForward", 1);
  check(cl.ok && cl.bindings.moveForward[1] === null && cl.bindings.moveForward[0] === "KeyW", "запасную клавишу можно убрать");
  const clPrimary = clearKey(base, "moveForward", 0);
  check(clPrimary.ok && clPrimary.bindings.moveForward[0] === "ArrowUp" && clPrimary.bindings.moveForward[1] === null, "основную можно убрать — запасная становится основной");
  const clLast = clearKey(base, "interact", 0);
  check(!clLast.ok && clLast.reason === "needs-key", "единственную клавишу убрать нельзя");
  check(clearKey(base, "interact", 1).ok, "очистка пустого слота — не ошибка");

  check(findBinding(base, "KeyG")?.action === "spellGraph" && findBinding(base, "KeyQ") === null, "findBinding находит владельца клавиши");
  check(JSON.stringify(resetBindings()) === JSON.stringify(defaultSettings().controls.bindings), "resetBindings = раскладка по умолчанию");
}

// --- подписи клавиш ---------------------------------------------------------------
check(keyLabel("KeyW") === "W" && keyLabel("Digit5") === "5" && keyLabel("ArrowUp") === "↑" && keyLabel("Space") === "Пробел" && keyLabel("Escape") === "Esc", "подписи клавиш");
check(keyLabel("F5") === "F5" && keyLabel("Numpad3") === "Num 3", "прочие клавиши");
check(describeKeys(["KeyW", "ArrowUp"]) === "W / ↑" && describeKeys(["KeyE", null]) === "E", "describeKeys");

if (failures > 0) {
  console.error(`\n${failures} из ${checks} проверок не прошли`);
  process.exit(1);
}
console.log(`OK: настройки прошли ${checks} проверок`);
