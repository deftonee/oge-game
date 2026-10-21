import { el } from "../dom";

/**
 * Небольшой набор виджетов для панели настроек. Общие для графики и управления,
 * чтобы разметка, доступность (role/aria) и стили не дублировались. Каждый
 * интерактивный элемент получает data-focus — по нему панель возвращает фокус
 * после перерисовки (клавиатурный пользователь не «теряет» место).
 */

export function button(text: string, className: string, onClick: () => void, focusKey?: string): HTMLButtonElement {
  const b = el("button", className, text);
  b.type = "button";
  if (focusKey) b.dataset.focus = focusKey;
  b.addEventListener("click", onClick);
  return b;
}

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
}

/** Переключатель «один из N» (radiogroup). */
export function segmented<T extends string | number>(
  name: string,
  options: ReadonlyArray<SegmentOption<T>>,
  current: T,
  onPick: (value: T) => void
): HTMLElement {
  const group = el("div", "pause-segmented");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", name);
  for (const opt of options) {
    const active = opt.value === current;
    const b = el("button", `pause-seg${active ? " is-active" : ""}`, opt.label);
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(active));
    b.dataset.focus = `${name}:${opt.value}`;
    b.addEventListener("click", () => {
      if (opt.value !== current) onPick(opt.value);
    });
    group.appendChild(b);
  }
  return group;
}

/** Выключатель (чекбокс с подписью). */
export function toggle(label: string, checked: boolean, onChange: (value: boolean) => void): HTMLElement {
  const wrap = el("label", "pause-toggle");
  const input = el("input");
  input.type = "checkbox";
  input.checked = checked;
  input.dataset.focus = `toggle:${label}`;
  input.addEventListener("change", () => onChange(input.checked));
  wrap.append(input, el("span", "pause-toggle-box"), el("span", "pause-toggle-label", label));
  return wrap;
}

export interface SliderOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onInput: (v: number) => void;
}

/**
 * Ползунок. Значение обновляется на лету, но панель НЕ перерисовывается во время
 * перетаскивания — иначе элемент, который тянут, пропал бы из-под пальца.
 */
export function slider(opts: SliderOptions): HTMLElement {
  const wrap = el("div", "pause-slider");
  const input = el("input");
  input.type = "range";
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  input.value = String(opts.value);
  input.setAttribute("aria-label", opts.label);
  input.dataset.focus = `slider:${opts.label}`;
  const readout = el("span", "pause-slider-value", opts.format(opts.value));
  input.addEventListener("input", () => {
    const v = parseFloat(input.value);
    readout.textContent = opts.format(v);
    opts.onInput(v);
  });
  wrap.append(input, readout);
  return wrap;
}

/** Строка настройки: подпись слева, элемент справа, под ними — необязательная подсказка. */
export function settingRow(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const row = el("div", "pause-row");
  const head = el("div", "pause-row-head");
  head.append(el("div", "pause-row-label", label), control);
  row.appendChild(head);
  if (hint) row.appendChild(el("div", "pause-row-hint", hint));
  return row;
}
