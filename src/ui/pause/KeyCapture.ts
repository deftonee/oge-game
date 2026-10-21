/**
 * Захват следующей нажатой клавиши для переназначения. Слушатель — в фазе
 * перехвата и гасит событие целиком (stopImmediatePropagation): игра в этот
 * момент не должна ни двигаться, ни открывать меню от «просто нажатой» клавиши.
 *
 * Esc — отмена (поэтому он зарезервирован и сам не назначается). Автоповтор
 * зажатой клавиши игнорируется, иначе захват срабатывал бы на «хвост» нажатия,
 * которым пользователь кликнул по кнопке с клавиатуры (Enter/Space).
 */
export interface KeyCaptureTarget {
  addEventListener(type: "keydown", listener: (e: KeyboardEvent) => void, capture: boolean): void;
  removeEventListener(type: "keydown", listener: (e: KeyboardEvent) => void, capture: boolean): void;
}

/** Возвращает функцию отмены (идемпотентна). onKey(null) — пользователь отменил. */
export function captureNextKey(target: KeyCaptureTarget, onKey: (code: string | null) => void): () => void {
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    target.removeEventListener("keydown", handler, true);
  };
  const handler = (e: KeyboardEvent): void => {
    if (e.repeat) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    finish();
    onKey(e.code === "Escape" || !e.code ? null : e.code);
  };
  target.addEventListener("keydown", handler, true);
  return finish;
}
