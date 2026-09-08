// Smoke-тесты мобильного управления (MobileControls) на happy-dom.
// Проверяются: ленивое монтирование, нормализация/мёртвый ход стика, клики кнопок,
// скрытие при открытом меню. DOM-уровень — happy-dom, как NullEngine для сцены.
import { Window } from "happy-dom";

declare const process: { exit(code?: number): never };

const FAILURES: string[] = [];

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ok  ${name}`);
  } else {
    FAILURES.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

interface CallCounters {
  interact: number;
  graph: number;
}

/** Изолированное окно happy-dom + счётчики колбэков MobileControls. */
function setupDom(): { win: Window; counters: CallCounters; args: () => { onInteract: () => void; onSpellGraph: () => void } } {
  const win = new Window({ url: "http://localhost/" });
  const globalThisAny = globalThis as unknown as Record<string, unknown>;
  for (const key of ["window", "document", "Element", "Event", "PointerEvent"] as const) {
    if (win[key] !== undefined) globalThisAny[key] = win[key];
  }
  const counters = { interact: 0, graph: 0 };
  const args = (): { onInteract: () => void; onSpellGraph: () => void } => ({
    onInteract: () => {
      counters.interact += 1;
    },
    onSpellGraph: () => {
      counters.graph += 1;
    },
  });
  return { win, counters, args };
}

function setCoarsePrimary(win: Window, coarse: boolean): void {
  win.matchMedia = ((query: string) => ({
    matches: query.includes("coarse") ? coarse : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as Window["matchMedia"];
}

import { MobileControls } from "../src/mobile/MobileControls";

// ---------- 1. Десктоп (fine pointer): монтируется только после touchstart ----------
{
  const { win, args } = setupDom();
  setCoarsePrimary(win, false);
  const controls = new MobileControls(args());
  check("десктоп: не смонтировано сразу", !controls.isActive);
  check("десктоп: нет .is-mobile на body", !win.document.body.classList.contains("is-mobile"));
  check("десктоп: нет .mobile-controls в DOM", win.document.querySelector(".mobile-controls") === null);

  win.dispatchEvent(new win.Event("touchstart"));
  check("десктоп: после touchstart смонтировано", controls.isActive);
  check("десктоп: .mobile-controls появился", win.document.querySelector(".mobile-controls") !== null);
  check("десктоп: body получил .is-mobile", win.document.body.classList.contains("is-mobile"));
}

// ---------- 2. Тач-устройство (coarse primary): монтируется сразу, стик работает ----------
{
  const { win, counters, args } = setupDom();
  setCoarsePrimary(win, true);
  const controls = new MobileControls(args());
  check("тач: смонтировано сразу", controls.isActive);

  const zero = controls.getMoveVector();
  check("тач: ноль без касаний", zero.x === 0 && zero.y === 0);

  const zone = win.document.querySelector(".joy-zone") as unknown as HTMLElement;
  check("тач: зона стика есть", zone !== null);

  const fire = (el: EventTarget, type: string, init: Record<string, unknown> = {}): void => {
    const ev = new win.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init });
    el.dispatchEvent(ev);
  };

  // Касание в точке (200, 300)
  fire(zone, "pointerdown", { clientX: 200, clientY: 300 });
  const atOrigin = controls.getMoveVector();
  check("стик: активен после pointerdown (ноль в точке касания)", atOrigin.x === 0 && atOrigin.y === 0);

  // Сдвиг на 40px вправо: нормализованный x = 40/56 ≈ 0.714
  fire(zone, "pointermove", { clientX: 240, clientY: 300 });
  const v = controls.getMoveVector();
  check("стик: x=40/56", Math.abs(v.x - 40 / 56) < 1e-9, `x=${v.x}`);
  check("стик: y=0", v.y === 0, `y=${v.y}`);

  // Сдвиг за радиус: clamp к 1.0
  fire(zone, "pointermove", { clientX: 340, clientY: 300 });
  const clamped = controls.getMoveVector();
  check("стик: clamp по радиусу", Math.abs(clamped.x - 1) < 1e-9 && clamped.y === 0, `x=${clamped.x}`);

  // Диагональ 45° вверх: x=+0.707, y=+0.707 (инверсия оси Y)
  fire(zone, "pointermove", { clientX: 200 + 39.6, clientY: 300 - 39.6 });
  const diag = controls.getMoveVector();
  check(
    "стик: диагональ нормирована",
    Math.abs(diag.x - diag.y) < 1e-9 && diag.x > 0 && diag.y > 0 && Math.hypot(diag.x, diag.y) > 0.99,
    `x=${diag.x}, y=${diag.y}`
  );

  // Мёртвый ход: сдвиг на 4px → ноль
  fire(zone, "pointermove", { clientX: 204, clientY: 300 });
  const dead = controls.getMoveVector();
  check("стик: мёртвый ход убирает малый сдвиг", dead.x === 0 && dead.y === 0, `x=${dead.x}`);

  // Отпускание: стик гаснет, база скрывается
  fire(zone, "pointerup", { clientX: 204, clientY: 300 });
  const afterUp = controls.getMoveVector();
  check("стик: после pointerup ноль", afterUp.x === 0 && afterUp.y === 0);
  const base = win.document.querySelector(".joy-base") as unknown as HTMLElement;
  check("стик: база скрыта", base.style.opacity === "0");

  // Кнопки: pointerdown дергает колбэки
  const interact = win.document.querySelector(".mobile-btn.interact") as unknown as HTMLButtonElement;
  const graph = win.document.querySelector(".mobile-btn.graph") as unknown as HTMLButtonElement;
  check("кнопки: присутствуют в DOM", interact !== null && graph !== null);
  fire(interact, "pointerdown", { clientX: 10, clientY: 10 });
  check("кнопка ✋: onInteract вызван", counters.interact === 1, `interact=${counters.interact}`);
  fire(graph, "pointerdown", { clientX: 10, clientY: 10 });
  check("кнопка 📜: onSpellGraph вызван", counters.graph === 1, `graph=${counters.graph}`);

  // setVisible(false) скрывает слой, setVisible(true) возвращает
  const root = win.document.querySelector(".mobile-controls") as unknown as HTMLElement;
  controls.setVisible(false);
  check("setVisible(false): display none", root.style.display === "none");
  const hiddenBase = (win.document.querySelector(".joy-base") as unknown as HTMLElement).style.opacity;
  check("setVisible(false): стик сброшен", hiddenBase === "0");
  controls.setVisible(true);
  check("setVisible(true): display block", root.style.display === "block");
}

// ---------- 3. Принудительный режим (force): эмуляция мобильного на десктопе ----------
{
  const { win, args } = setupDom();
  setCoarsePrimary(win, false); // десктоп: fine pointer
  const controls = new MobileControls({ ...args(), force: true });
  check("force: смонтировано сразу без coarse-указателя", controls.isActive);
  check("force: .mobile-controls в DOM", win.document.querySelector(".mobile-controls") !== null);
  check("force: body получил .is-mobile", win.document.body.classList.contains("is-mobile"));

  // Стик мышью: pointerdown + pointermove дают вектор, как на тач-устройстве
  const zone = win.document.querySelector(".joy-zone") as unknown as HTMLElement;
  const fire = (el: EventTarget, type: string, init: Record<string, unknown> = {}): void => {
    const ev = new win.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, ...init });
    el.dispatchEvent(ev as unknown as Event); // happy-dom PointerEvent не совместим с lib.dom Event
  };
  fire(zone, "pointerdown", { clientX: 100, clientY: 200 });
  fire(zone, "pointermove", { clientX: 100 + 56, clientY: 200 });
  const v = controls.getMoveVector();
  check("force: стик мышью даёт x=1", Math.abs(v.x - 1) < 1e-9 && v.y === 0, `x=${v.x}, y=${v.y}`);
}

console.log("");
if (FAILURES.length > 0) {
  console.error(`FAILED: ${FAILURES.length}`);
  process.exit(1);
}
console.log("OK: мобильное управление прошло проверки");