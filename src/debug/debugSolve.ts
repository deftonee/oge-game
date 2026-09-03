/**
 * Отладка: кнопка «Решено» — мгновенно подставляет верный ответ и вызывает
 * существующий обработчик сабмита. Все переходы (счёт дуэли, мастерство,
 * открытие гейта, этапы обучения) идут по штатному пути, как при ручном ответе.
 *
 * Видна только в `vite dev`: в production-сборке Vite статически заменяет
 * `import.meta.env.DEV` на false, ветка выкидывается при dead-code elimination.
 */
const DEBUG_SOLVE = import.meta.env.DEV;

export function appendSolvedButton(
  panel: HTMLElement,
  input: HTMLInputElement,
  answer: number,
  onSubmit: () => void,
): void {
  if (!DEBUG_SOLVE) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "combat-solve";
  btn.title = "Отладка: засчитать верный ответ";
  btn.textContent = "Решено ✓";
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    btn.disabled = true; // защита от двойного клика — сабмит не идемпотентен
    input.value = String(answer);
    onSubmit();
  });
  panel.appendChild(btn);
}