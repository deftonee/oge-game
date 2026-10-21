import { ACTIONS, defaultBindings } from "./settings";
import type { ActionId, Bindings, KeyPair, KeySlot } from "./settings";

/**
 * Операции над раскладкой клавиш — чистые функции: берут Bindings, возвращают
 * НОВЫЙ объект. Правила одни на всё меню:
 *  - у каждого действия всегда есть основная клавиша (его нельзя «разоружить»);
 *  - одна клавиша — одно действие: занимая чужую клавишу, мы её забираем, а если
 *    у хозяина это была последняя клавиша — он получает нашу прежнюю (обмен);
 *  - некоторые клавиши зарезервированы (Esc — «отмена» в меню).
 */

export const RESERVED_CODES: readonly string[] = ["Escape", "Backquote"];

export type AssignFailure = "reserved" | "needs-key";

export type AssignResult = { ok: true; bindings: Bindings } | { ok: false; reason: AssignFailure };

function clone(b: Bindings): Bindings {
  const out = {} as Bindings;
  for (const a of ACTIONS) out[a] = [...b[a]] as KeyPair;
  return out;
}

/** Какое действие сейчас занимает клавишу (и в каком слоте). */
export function findBinding(b: Bindings, code: string): { action: ActionId; slot: 0 | 1 } | null {
  for (const action of ACTIONS) {
    if (b[action][0] === code) return { action, slot: 0 };
    if (b[action][1] === code) return { action, slot: 1 };
  }
  return null;
}

/**
 * Назначает клавишу в слот действия. Esc и служебные клавиши отклоняются, но у
 * действия «pause» Esc уже стоит по умолчанию — это отдельная привязка, а не переназначение.
 */
export function assignKey(bindings: Bindings, action: ActionId, slot: 0 | 1, code: string): AssignResult {
  if (RESERVED_CODES.includes(code) && bindings[action][slot] !== code) return { ok: false, reason: "reserved" };

  const next = clone(bindings);
  const displaced: KeySlot = next[action][slot];
  const owner = findBinding(next, code);

  if (owner && !(owner.action === action && owner.slot === slot)) {
    const holder = next[owner.action];
    if (owner.action === action) {
      // та же клавиша в другом слоте этого действия — просто переезжает
      holder[owner.slot] = null;
    } else if (owner.slot === 1 || holder[1] !== null) {
      // у хозяина есть другая клавиша — забираем эту
      if (owner.slot === 0) {
        holder[0] = holder[1];
        holder[1] = null;
      } else {
        holder[1] = null;
      }
    } else if (displaced) {
      holder[0] = displaced; // последняя клавиша хозяина — меняемся
    } else {
      return { ok: false, reason: "needs-key" };
    }
  }

  next[action][slot] = code;
  // Основная клавиша обязана быть задана: если очистили её слот — запасная становится основной.
  if (next[action][0] === null) {
    next[action][0] = next[action][1];
    next[action][1] = null;
  }
  return { ok: true, bindings: next };
}

/** Освобождает слот. Единственную клавишу действия убрать нельзя. */
export function clearKey(bindings: Bindings, action: ActionId, slot: 0 | 1): AssignResult {
  const pair = bindings[action];
  const remaining = pair.filter((k, i) => i !== slot && k !== null).length;
  if (pair[slot] === null) return { ok: true, bindings: clone(bindings) };
  if (remaining === 0) return { ok: false, reason: "needs-key" };
  const next = clone(bindings);
  next[action][slot] = null;
  if (next[action][0] === null) {
    next[action][0] = next[action][1];
    next[action][1] = null;
  }
  return { ok: true, bindings: next };
}

export function resetBindings(): Bindings {
  return defaultBindings();
}

// ---------------------------------------------------------------------------
// Подписи
// ---------------------------------------------------------------------------

export const ACTION_LABELS: Readonly<Record<ActionId, string>> = {
  moveForward: "Вперёд",
  moveBack: "Назад",
  moveLeft: "Влево",
  moveRight: "Вправо",
  interact: "Взаимодействие",
  spellGraph: "Граф заклинаний",
  pause: "Пауза / меню",
};

const SPECIAL_LABELS: Readonly<Record<string, string>> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Space: "Пробел",
  Escape: "Esc",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  ShiftLeft: "Shift",
  ShiftRight: "Shift (прав.)",
  ControlLeft: "Ctrl",
  ControlRight: "Ctrl (прав.)",
  AltLeft: "Alt",
  AltRight: "Alt (прав.)",
};

/** Читаемое имя клавиши по KeyboardEvent.code: KeyW → «W», Digit1 → «1», ArrowUp → «↑». */
export function keyLabel(code: string): string {
  if (SPECIAL_LABELS[code]) return SPECIAL_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

/** «W / ↑» — обе клавиши действия для подсказок. */
export function describeKeys(pair: KeyPair): string {
  return pair.filter((k): k is string => k !== null).map(keyLabel).join(" / ");
}

/**
 * Строка-подсказка управления для HUD по текущей раскладке: «WASD — движение · мышь — камера · …».
 * Показывает основные клавиши; если все четыре направления — одиночные символы, пишет их слитно.
 */
export function describeControlsHint(bindings: Bindings): string {
  const primary = (a: ActionId): string => keyLabel(bindings[a][0] ?? "");
  const moves = [primary("moveForward"), primary("moveLeft"), primary("moveBack"), primary("moveRight")];
  const movement = moves.every((m) => m.length === 1) ? moves.join("") : moves.join("/");
  return [
    `${movement} — движение`,
    "мышь — камера",
    `${primary("spellGraph")} — граф заклинаний`,
    `${primary("interact")} — взаимодействие рядом`,
    `${primary("pause")} — пауза`,
  ].join(" · ");
}
