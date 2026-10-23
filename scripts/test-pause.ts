// Меню паузы: открытие/закрытие, Esc как «назад», клавиша паузы, подтверждение выхода,
// настройки (графика, управление, переназначение клавиш) и подключение паузы к вводу
// (createInteraction): Esc сначала закрывает окна, не «протекает» в игру, мобильная кнопка.
// DOM — happy-dom, как в остальных UI-тестах; сцена и менеджеры не нужны (подменяются заглушками).
import { Window } from "happy-dom";
import { GameState } from "../src/core/GameState";
import { KeyBindings } from "../src/core/KeyBindings";
import { createInteraction } from "../src/core/interaction";
import type { GameManagers } from "../src/core/managers";
import { ALL_BOOKS } from "../src/data/books";
import { SETTINGS_KEY } from "../src/settings/settingsStorage";
import type { KeyValueStorage } from "../src/settings/settingsStorage";
import { SettingsStore } from "../src/settings/SettingsStore";
import { PauseMenu } from "../src/ui/pause/PauseMenu";
import type { PauseMenuDeps } from "../src/ui/pause/PauseMenu";
import type { QualityTier } from "../src/core/quality";

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
const g = globalThis as unknown as Record<string, unknown>;
g.window = win;
g.document = win.document;
const doc = win.document;
const asWindow = win as unknown as Window;

function memoryStorage(): KeyValueStorage & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

function freshRoot(): HTMLElement {
  doc.body.innerHTML = "";
  const root = doc.createElement("div");
  doc.body.appendChild(root);
  return root as unknown as HTMLElement;
}

/** Нажатие клавиши, как в браузере: событие идёт от элемента вверх (window ловит и в capture, и в bubble). */
function press(code: string, init: Record<string, unknown> = {}, target?: unknown): KeyboardEvent {
  const ev = new win.KeyboardEvent("keydown", { code, key: code, bubbles: true, cancelable: true, ...init });
  ((target ?? doc.body) as EventTarget).dispatchEvent(ev as unknown as Event);
  return ev as unknown as KeyboardEvent;
}

function find(root: ParentNode, selector: string): HTMLElement | null {
  return root.querySelector(selector) as HTMLElement | null;
}

/** Элемент панели по data-focus (так же панель сама возвращает фокус после перерисовки). */
function byFocus(root: ParentNode, key: string): HTMLElement | null {
  return (Array.from(root.querySelectorAll("[data-focus]")) as HTMLElement[]).find((n) => n.dataset.focus === key) ?? null;
}

function click(node: HTMLElement | null, what: string): void {
  if (!node) {
    check(false, `нет элемента для клика: ${what}`);
    return;
  }
  node.click();
}

const text = (node: ParentNode | null): string => (node as HTMLElement | null)?.textContent ?? "";

interface Rig {
  root: HTMLElement;
  menu: PauseMenu;
  store: SettingsStore;
  storage: ReturnType<typeof memoryStorage>;
  keys: KeyBindings;
  gameState: GameState;
  log: { opened: number; closed: number; newGames: number };
  /** Сколько keydown дошло до слушателя игры в фазе всплытия. */
  gameKeys: () => number;
  dispose(): void;
}

function makeRig(over: Partial<PauseMenuDeps> = {}): Rig {
  const root = freshRoot();
  const storage = memoryStorage();
  const store = new SettingsStore(storage);
  const keys = new KeyBindings(store, asWindow);
  const gameState = new GameState();
  const log = { opened: 0, closed: 0, newGames: 0 };
  let seen = 0;
  const probe = (): void => void seen++;
  win.addEventListener("keydown", probe);
  const menu = new PauseMenu(root, {
    gameState,
    settings: store,
    onNewGame: () => void log.newGames++,
    canSave: () => true,
    isPauseKey: (e) => keys.matches("pause", e),
    isTouch: () => false,
    activeTier: () => "mid" as QualityTier,
    autoTier: () => "mid" as QualityTier,
    qualityFromUrl: () => false,
    keyTarget: asWindow,
    onOpen: () => void log.opened++,
    onClose: () => void log.closed++,
    ...over,
  });
  return {
    root,
    menu,
    store,
    storage,
    keys,
    gameState,
    log,
    gameKeys: () => seen,
    dispose: () => {
      menu.close();
      keys.dispose();
      win.removeEventListener("keydown", probe);
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Открытие и закрытие
// ---------------------------------------------------------------------------
{
  const r = makeRig();
  check(!r.menu.isOpen, "по умолчанию пауза закрыта");
  check(r.menu.open() === true && r.menu.isOpen, "open() открывает паузу");
  check(r.menu.open() === false, "повторный open() ничего не делает");
  check(r.log.opened === 1, "onOpen вызван один раз");
  check(find(r.root, ".pause-overlay") !== null && find(r.root, ".pause-panel") !== null, "оверлей и панель в DOM");
  check(find(r.root, ".pause-panel")!.getAttribute("role") === "dialog", "панель — dialog (доступность)");

  const acts = (Array.from(r.root.querySelectorAll(".pause-menu button")) as HTMLElement[]).map((b) => b.dataset.act);
  check(acts.join() === "resume,inventory,settings,new-game", `разделы меню по порядку (${acts.join()})`);
  check(find(r.root, ".pause-inventory") !== null, "по умолчанию открыт инвентарь");
  check((doc.activeElement as HTMLElement | null)?.dataset?.act === "resume", "фокус на «Продолжить»");

  click(find(r.root, '[data-act="resume"]'), "Продолжить");
  check(!r.menu.isOpen && find(r.root, ".pause-overlay") === null, "«Продолжить» закрывает и убирает DOM");
  check(r.log.closed === 1, "onClose вызван один раз");
  r.menu.close();
  check(r.log.closed === 1, "повторный close() onClose не вызывает");
  r.menu.toggle();
  check(r.menu.isOpen, "toggle() открывает");
  r.menu.toggle();
  check(!r.menu.isOpen, "toggle() закрывает");
  r.dispose();
}

// ---------------------------------------------------------------------------
// 2. Клавиши: Esc — «назад», клавиша паузы — «продолжить»
// ---------------------------------------------------------------------------
{
  const r = makeRig();
  r.menu.open();
  const ev = press("Escape");
  check(!r.menu.isOpen, "Esc из инвентаря продолжает игру");
  check(ev.defaultPrevented, "Esc отменяет действие браузера по умолчанию");

  r.menu.open();
  click(find(r.root, '[data-act="settings"]'), "Настройки");
  check(find(r.root, ".pause-settings") !== null && find(r.root, ".pause-inventory") === null, "раздел «Настройки» открыт");
  check(find(r.root, '[data-act="settings"]')!.getAttribute("aria-current") === "page", "текущий раздел помечен aria-current");
  press("Escape");
  check(r.menu.isOpen && find(r.root, ".pause-inventory") !== null, "Esc из настроек возвращает в инвентарь, пауза остаётся");
  press("Escape");
  check(!r.menu.isOpen, "второй Esc продолжает игру");

  r.menu.open();
  click(find(r.root, '[data-act="settings"]'), "Настройки");
  press("KeyP");
  check(!r.menu.isOpen, "клавиша паузы (P) закрывает из любого раздела");

  // Автоповтор зажатой клавиши не должен «мигать» меню.
  r.menu.open();
  click(find(r.root, '[data-act="settings"]'), "Настройки");
  press("Escape", { repeat: true });
  check(r.menu.isOpen && find(r.root, ".pause-settings") !== null, "повтор зажатого Esc не откатывает меню");
  press("KeyP", { repeat: true });
  check(r.menu.isOpen, "повтор зажатой P не закрывает меню");

  // Навигация стрелками по разделам.
  r.menu.close();
  r.menu.open();
  const down = press("ArrowDown", {}, doc.activeElement);
  check((doc.activeElement as HTMLElement | null)?.dataset?.act === "inventory" && down.defaultPrevented, "↓ переводит фокус на следующий раздел");
  press("ArrowUp", {}, doc.activeElement);
  press("ArrowUp", {}, doc.activeElement);
  check((doc.activeElement as HTMLElement | null)?.dataset?.act === "new-game", "↑ с первого раздела уходит на последний (по кругу)");
  r.dispose();
}

// ---------------------------------------------------------------------------
// 3. Игра не видит клавиши, пока меню открыто
// ---------------------------------------------------------------------------
{
  const r = makeRig();
  press("KeyW");
  check(r.keys.isDown("moveForward"), "до паузы клавиша движения доходит до игры");
  r.keys.clearPressed();

  r.menu.open();
  const before = r.gameKeys();
  press("KeyW");
  press("KeyE");
  press("KeyG");
  check(r.gameKeys() === before, "пока открыта пауза, keydown до слушателей игры не доходит");
  check(!r.keys.isDown("moveForward"), "KeyBindings не запоминает нажатия во время паузы (персонаж не пойдёт)");

  r.menu.close();
  press("KeyW");
  check(r.keys.isDown("moveForward"), "после закрытия клавиши снова доходят до игры");
  r.dispose();
}

// ---------------------------------------------------------------------------
// 4. «Новая игра»: только после подтверждения
// ---------------------------------------------------------------------------
{
  const r = makeRig();
  r.menu.open();
  click(find(r.root, '[data-act="new-game"]'), "Новая игра");
  check(find(r.root, ".pause-confirm") !== null, "показан диалог подтверждения");
  check(r.log.newGames === 0, "одно нажатие «Новая игра» ещё ничего не стирает");
  check(find(r.root, ".pause-confirm")!.getAttribute("role") === "alertdialog", "подтверждение — alertdialog");
  check(text(find(r.root, ".pause-confirm")).includes("сохранённый прогресс будет стёрт"), "диалог честно предупреждает о потере прогресса");

  click(find(r.root, '.pause-confirm [data-act="stay"]'), "Остаться");
  check(r.menu.isOpen && find(r.root, ".pause-inventory") !== null && r.log.newGames === 0, "«Остаться» возвращает в инвентарь, ничего не стирая");

  click(find(r.root, '[data-act="new-game"]'), "Новая игра");
  press("Escape");
  check(r.menu.isOpen && find(r.root, ".pause-inventory") !== null && r.log.newGames === 0, "Esc в подтверждении = «Остаться», а не новая игра");

  click(find(r.root, '[data-act="new-game"]'), "Новая игра");
  click(find(r.root, '.pause-confirm [data-act="start-over"]'), "Начать заново");
  check(r.log.newGames === 1, "подтверждённая новая игра вызывает onNewGame ровно один раз");
  check(!r.menu.isOpen && r.log.closed === 1, "перед новой игрой меню закрыто");
  r.dispose();
}

// Строка про автосохранение: честно сообщает, если сохранять нельзя.
{
  const ok = makeRig({ canSave: () => true });
  ok.menu.open();
  check(text(find(ok.root, ".pause-save-note")).includes("сохраняется автоматически") && find(ok.root, ".pause-save-note.is-warning") === null, "сохранение работает — спокойная строка");
  ok.dispose();

  const bad = makeRig({ canSave: () => false });
  bad.menu.open();
  check(find(bad.root, ".pause-save-note.is-warning") !== null && text(find(bad.root, ".pause-save-note")).includes("не даёт сохранять"), "сохранять нельзя — предупреждение");
  const buttons = (Array.from(bad.root.querySelectorAll(".pause-menu button")) as HTMLElement[]).length;
  check(buttons === 4, "строка про сохранение не мешает навигации по разделам (кнопок по-прежнему 4)");
  bad.dispose();
}

// ---------------------------------------------------------------------------
// 5. Инвентарь
// ---------------------------------------------------------------------------
{
  const r = makeRig();
  r.gameState.collectBook(ALL_BOOKS[0].id);
  r.menu.open();
  const chips = Array.from(r.root.querySelectorAll(".pause-chip")) as HTMLElement[];
  check(chips.length === ALL_BOOKS.length, `по карточке на каждую книгу (${chips.length}/${ALL_BOOKS.length})`);
  check(chips.filter((c) => c.classList.contains("is-have")).length === 1, "найденная книга помечена is-have, остальные — нет");
  check(find(r.root, ".graph-body") !== null, "дерево изученных заклинаний нарисовано (в т.ч. пустое состояние)");
  r.dispose();
}

// ---------------------------------------------------------------------------
// 6. Настройки: графика
// ---------------------------------------------------------------------------
{
  const r = makeRig();
  r.menu.open();
  click(find(r.root, '[data-act="settings"]'), "Настройки");

  check(find(r.root, ".pause-tab.is-active")?.getAttribute("aria-selected") === "true", "вкладка «Графика» активна по умолчанию");

  click(byFocus(r.root, "Разрешение:0.5"), "разрешение 50%");
  check(r.store.get().graphics.renderScale === 0.5, "выбор 50% меняет настройку сразу");
  check(byFocus(r.root, "Разрешение:0.5")?.getAttribute("aria-checked") === "true", "после выбора кнопка отмечена (панель перерисована)");
  check(JSON.parse(r.storage.data[SETTINGS_KEY]).graphics.renderScale === 0.5, "настройка сохранена в хранилище");

  const fps = byFocus(r.root, "toggle:Показывать FPS") as unknown as HTMLInputElement;
  fps.checked = true;
  fps.dispatchEvent(new win.Event("change", { bubbles: true }) as unknown as Event);
  check(r.store.get().graphics.showFps === true, "переключатель FPS меняет настройку");

  click(byFocus(r.root, "Качество:low"), "качество: низкое");
  check(r.store.get().graphics.quality === "low", "качество сохраняется в настройках");
  check(text(find(r.root, ".pause-tabpanel")).includes("следующем запуске"), "если выбранное качество ≠ текущему — подсказка про следующий запуск");

  click(byFocus(r.root, "reset:graphics"), "сброс графики");
  const gr = r.store.get().graphics;
  check(gr.quality === "auto" && gr.renderScale === 1 && gr.showFps === false, "«Сбросить графику» возвращает значения по умолчанию");
  check(text(find(r.root, ".pause-message")).includes("сброшена"), "после сброса есть сообщение");
  r.dispose();

  const url = makeRig({ qualityFromUrl: () => true });
  url.menu.open();
  click(find(url.root, '[data-act="settings"]'), "Настройки");
  check(text(find(url.root, ".pause-tabpanel")).includes("?quality="), "если качество задано в адресе — об этом сказано");
  url.dispose();

  const same = makeRig({ activeTier: () => "mid", autoTier: () => "mid" });
  same.menu.open();
  click(find(same.root, '[data-act="settings"]'), "Настройки");
  check(!text(find(same.root, ".pause-tabpanel")).includes("следующем запуске"), "при «Авто» и совпадении уровней подсказки про перезапуск нет");
  same.dispose();
}

// ---------------------------------------------------------------------------
// 7. Настройки: управление
// ---------------------------------------------------------------------------
{
  const r = makeRig();
  r.menu.open();
  click(find(r.root, '[data-act="settings"]'), "Настройки");
  click(byFocus(r.root, "tab:controls"), "вкладка «Управление»");
  check(find(r.root, ".pause-keys") !== null, "на десктопе показана таблица клавиш");

  // Ползунок: значение меняется на лету, панель при этом НЕ перерисовывается (иначе ползунок пропал бы из-под пальца).
  const slider = byFocus(r.root, "slider:Чувствительность камеры") as unknown as HTMLInputElement;
  slider.value = "2";
  slider.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
  check(r.store.get().controls.mouseSensitivity === 2, "ползунок меняет чувствительность");
  check(byFocus(r.root, "slider:Чувствительность камеры") === (slider as unknown as HTMLElement), "во время перетаскивания ползунок остаётся тем же элементом");
  check(text(find(r.root, ".pause-slider-value")).includes("2.00"), "рядом с ползунком показано значение");

  const invert = byFocus(r.root, "toggle:Инвертировать") as unknown as HTMLInputElement;
  invert.checked = true;
  invert.dispatchEvent(new win.Event("change", { bubbles: true }) as unknown as Event);
  check(r.store.get().controls.invertY === true, "переключатель инверсии меняет настройку");

  // Переназначение клавиши.
  click(byFocus(r.root, "key:interact:0"), "клавиша «Взаимодействие»");
  check(text(byFocus(r.root, "key:interact:0")).includes("Нажми клавишу"), "кнопка ждёт клавишу");
  const seenBefore = r.gameKeys();
  press("KeyF");
  check(r.store.get().controls.bindings.interact[0] === "KeyF", "следующая нажатая клавиша назначается (F)");
  check(text(byFocus(r.root, "key:interact:0")) === "F", "в таблице видна новая клавиша");
  check(r.gameKeys() === seenBefore, "нажатая при переназначении клавиша до игры не доходит");
  check(r.menu.isOpen, "переназначение не закрывает меню");

  // Esc во время ожидания: отмена, а не «назад» и не закрытие.
  click(byFocus(r.root, "key:interact:0"), "клавиша «Взаимодействие»");
  press("Escape");
  check(r.menu.isOpen && find(r.root, ".pause-settings") !== null, "Esc при ожидании клавиши не закрывает меню и не уходит из настроек");
  check(!text(byFocus(r.root, "key:interact:0")).includes("Нажми клавишу") && r.store.get().controls.bindings.interact[0] === "KeyF", "Esc отменил ожидание без изменений");
  press("Escape");
  check(find(r.root, ".pause-inventory") !== null, "следующий Esc — обычное «назад»");

  // Зарезервированная клавиша.
  click(find(r.root, '[data-act="settings"]'), "Настройки");
  click(byFocus(r.root, "tab:controls"), "вкладка «Управление»");
  click(byFocus(r.root, "key:spellGraph:0"), "клавиша «Граф заклинаний»");
  press("Backquote");
  check(r.store.get().controls.bindings.spellGraph[0] === "KeyG", "зарезервированная клавиша не назначается");
  check(text(find(r.root, ".pause-message")).includes("зарезервирована"), "причина отказа показана");

  // Переназначение незавершено, а меню закрыли — слушатель не должен «съедать» клавиши игры.
  click(byFocus(r.root, "key:spellGraph:0"), "клавиша «Граф заклинаний»");
  r.menu.close();
  const afterClose = r.gameKeys();
  press("KeyW");
  check(r.gameKeys() === afterClose + 1 && r.keys.isDown("moveForward"), "закрытие меню во время ожидания клавиши снимает перехват");

  // Сброс управления.
  r.menu.open();
  click(find(r.root, '[data-act="settings"]'), "Настройки");
  click(byFocus(r.root, "tab:controls"), "вкладка «Управление»");
  click(byFocus(r.root, "reset:controls"), "сброс управления");
  const c = r.store.get().controls;
  check(c.mouseSensitivity === 1 && c.invertY === false && c.bindings.interact[0] === "KeyE", "«Сбросить управление» возвращает чувствительность, инверсию и клавиши");
  r.dispose();

  // Сенсорное устройство: клавиатурных привязок нет.
  const t = makeRig({ isTouch: () => true });
  t.menu.open();
  click(find(t.root, '[data-act="settings"]'), "Настройки");
  click(byFocus(t.root, "tab:controls"), "вкладка «Управление»");
  check(find(t.root, ".pause-keys") === null && text(find(t.root, ".pause-tabpanel")).includes("Сенсорное управление"), "на сенсорном устройстве вместо клавиш — подсказка про стик");
  t.dispose();
}

// ---------------------------------------------------------------------------
// 8. Подключение к вводу (createInteraction)
// ---------------------------------------------------------------------------
{
  const root = freshRoot();
  const storage = memoryStorage();
  const store = new SettingsStore(storage);
  const keys = new KeyBindings(store, asWindow);
  const gameState = new GameState();

  const flags = { combat: false, graph: false, learning: false, practice: false, gates: false, chest: false, loot: false };
  const closedLog: string[] = [];
  const counters = { learningOpen: 0 };
  const closer = (name: keyof typeof flags) => (): void => {
    flags[name] = false;
    closedLog.push(name);
  };
  const managers = {
    combat: { get isActive() { return flags.combat; } },
    spellGraph: { get isOpen() { return flags.graph; }, close: closer("graph"), toggle: () => void (flags.graph = !flags.graph) },
    learning: { get isActive() { return flags.learning; }, close: closer("learning"), open: () => void counters.learningOpen++ },
    practice: { get isActive() { return flags.practice; }, close: closer("practice"), open: () => {} },
    gates: { get isActive() { return flags.gates; }, close: closer("gates"), open: () => {} },
    chestLoot: { get isOpen() { return flags.chest; }, close: closer("chest"), show: () => {} },
    lootPresenter: { get isActive() { return flags.loot; } },
  } as unknown as GameManagers;

  const proximity = { nearGate: null, nearBonfire: null, nearChest: null, nearFriendlyWitch: null, nearPracticeTarget: null };

  let opened = 0;
  const pause = new PauseMenu(root, {
    gameState,
    settings: store,
    onNewGame: () => {},
    canSave: () => true,
    isPauseKey: (e) => keys.matches("pause", e),
    isTouch: () => true,
    activeTier: () => "mid",
    autoTier: () => "mid",
    qualityFromUrl: () => false,
    keyTarget: asWindow,
    // как в Game: зажатые клавиши забываем при открытии паузы
    onOpen: () => {
      opened++;
      keys.clearPressed();
    },
  });

  const api = createInteraction({
    managers,
    proximity: proximity as never,
    gameState,
    keys,
    backpack: {} as never,
    screen: {} as never,
    duelRoundsToWin: () => 3,
    emulateMobile: true,
    pause,
  });

  const reset = (): void => {
    pause.close();
    for (const k of Object.keys(flags) as Array<keyof typeof flags>) flags[k] = false;
    closedLog.length = 0;
    proximity.nearBonfire = null;
  };

  // Esc / P открывают и закрывают паузу.
  press("Escape");
  check(pause.isOpen, "Esc при свободном экране открывает паузу");
  check(api.anyMenuOpen(), "пока пауза открыта, anyMenuOpen() = true (мир стоит, ввод заблокирован)");
  press("Escape");
  check(!pause.isOpen && opened === 1, "Esc при открытой паузе закрывает её и в тот же момент не открывает заново");
  press("KeyP");
  check(pause.isOpen, "P открывает паузу");
  press("KeyP");
  check(!pause.isOpen && opened === 2, "P при открытой паузе закрывает её и не переоткрывает");
  check(!api.anyMenuOpen(), "после закрытия anyMenuOpen() = false");
  reset();

  // Esc сначала закрывает окна, паузу в тот же кадр не открывает.
  flags.graph = true;
  press("Escape");
  check(!flags.graph && !pause.isOpen && closedLog.join() === "graph", "Esc закрывает граф заклинаний, паузу не открывает");
  press("Escape");
  check(pause.isOpen, "следующий Esc (окон нет) открывает паузу");
  reset();

  flags.learning = true;
  flags.chest = true;
  press("Escape");
  check(!flags.learning && !flags.chest && !pause.isOpen, "Esc закрывает все закрываемые окна разом и паузу не открывает");
  reset();

  // Окна, которые Esc не закрывает (бой, презентация находок), паузу не открывают.
  flags.combat = true;
  press("Escape");
  press("KeyP");
  check(!pause.isOpen, "во время боя Esc/P паузу не открывают");
  reset();
  flags.loot = true;
  press("Escape");
  press("KeyP");
  check(!pause.isOpen, "во время презентации находок Esc/P паузу не открывают");
  reset();

  // P при открытом окне паузу не открывает.
  flags.graph = true;
  press("KeyP");
  check(!pause.isOpen && flags.graph, "P при открытом графе паузу не открывает");
  reset();

  // Печать в поле ввода — не горячие клавиши.
  const input = doc.createElement("input");
  doc.body.appendChild(input);
  press("KeyP", {}, input);
  check(!pause.isOpen, "P в поле ввода (ответ в бою/у костра) паузу не открывает");
  flags.learning = true;
  press("Escape", {}, input);
  check(!flags.learning && !pause.isOpen, "Esc в поле ввода закрывает окно, но паузу не открывает");
  input.remove();
  reset();

  // Автоповтор зажатого Esc.
  press("Escape", { repeat: true });
  press("KeyP", { repeat: true });
  check(!pause.isOpen, "автоповтор зажатой клавиши паузу не открывает");

  // Переназначенная клавиша паузы.
  store.bindKey("pause", 1, "KeyU");
  press("KeyP");
  check(!pause.isOpen, "после переназначения старая клавиша паузы (P) больше не работает");
  press("KeyU");
  check(pause.isOpen, "новая клавиша паузы (U) открывает паузу");
  reset();
  store.resetBindings();

  // Клавиши движения не «залипают»: зажатая клавиша забывается при открытии паузы.
  press("KeyW");
  check(keys.isDown("moveForward"), "до паузы W зажата");
  press("Escape");
  check(pause.isOpen && !keys.isDown("moveForward"), "при открытии паузы зажатые клавиши забыты");
  reset();

  // requestPause (автопауза при скрытии вкладки): открывает паузу только если ничего другого нет.
  const openedBeforeRequest = opened;
  api.requestPause();
  check(pause.isOpen, "requestPause открывает паузу");
  api.requestPause();
  check(pause.isOpen && opened === openedBeforeRequest + 1, "повторный requestPause паузу не переоткрывает");
  reset();
  flags.combat = true;
  api.requestPause();
  check(!pause.isOpen, "requestPause не открывает паузу поверх боя");
  reset();
  flags.graph = true;
  api.requestPause();
  check(!pause.isOpen, "requestPause не открывает паузу поверх графа заклинаний");
  reset();
  flags.loot = true;
  api.requestPause();
  check(!pause.isOpen, "requestPause не открывает паузу поверх показа находок");
  reset();

  // Мобильная кнопка паузы.
  const pauseBtn = find(doc.body, ".mobile-btn.pause");
  check(pauseBtn !== null, "мобильная кнопка паузы создана");
  const tap = (node: HTMLElement | null): void => {
    node?.dispatchEvent(new win.PointerEvent("pointerdown", { bubbles: true, cancelable: true }) as unknown as Event);
  };
  const openedBefore = opened;
  tap(pauseBtn);
  check(pause.isOpen && opened === openedBefore + 1, "касание кнопки паузы открывает паузу");
  tap(pauseBtn);
  check(pause.isOpen && opened === openedBefore + 1, "повторное касание паузу не переоткрывает");
  reset();
  flags.combat = true;
  tap(pauseBtn);
  check(!pause.isOpen, "кнопка паузы не открывает паузу поверх боя");
  reset();
  flags.graph = true;
  tap(pauseBtn);
  check(!pause.isOpen, "кнопка паузы не открывает паузу поверх графа");
  reset();

  // «Взаимодействие» при открытой паузе не срабатывает.
  proximity.nearBonfire = {} as never;
  const interact = find(doc.body, ".mobile-btn.interact");
  pause.open();
  tap(interact);
  check(counters.learningOpen === 0, "при открытой паузе кнопка «взаимодействие» ничего не открывает");
  pause.close();
  tap(interact);
  check(counters.learningOpen === 1, "без паузы та же кнопка работает (контроль)");
  reset();

  keys.dispose();
}

console.log(`\n${checks - failures}/${checks} проверок пройдено`);
if (failures > 0) {
  console.error(`FAILED: ${failures}`);
  process.exit(1);
}
console.log("OK: меню паузы и настройки прошли проверки");
