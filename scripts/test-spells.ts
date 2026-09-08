// Smoke-тест новой системы заклинаний: JSON-реестр, школы, роли задач,
// разблокировка школ (правило мостов). Запуск: npm run test:spells.
declare const process: { exit(code?: number): never };

import {
  ALL_SCHOOLS,
  ALL_SPELLS,
  getSchoolById,
  getSpellsBySchool,
  hasQuestionRole,
  isBridgeSpell,
  questionsFor,
} from "../src/data/spells";
import { GameState } from "../src/core/GameState";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  }
}

// --- Реестр ---
check(ALL_SCHOOLS.length === 5, `ожидал 5 школ, получил ${ALL_SCHOOLS.length}`);
check(ALL_SPELLS.length === 9, `ожидал 9 заклинаний (6 земля + 3 огонь), получил ${ALL_SPELLS.length}`);

const ids = new Set<string>();
for (const s of ALL_SPELLS) {
  check(!ids.has(s.id), `дубликат id заклинания ${s.id}`);
  ids.add(s.id);

  // Обязательные роли: защита от ведьмы и тренировка у цели.
  check(hasQuestionRole(s, "defendWitch"), `${s.id}: нет банка defendWitch`);
  check(hasQuestionRole(s, "staticTarget"), `${s.id}: нет банка staticTarget`);
  check(questionsFor(s, "defendWitch").length > 0, `${s.id}: defendWitch пуст`);
  check(questionsFor(s, "staticTarget").length > 0, `${s.id}: staticTarget пуст`);
  if (!isBridgeSpell(s)) {
    check(hasQuestionRole(s, "attackWitch"), `${s.id}: у обычного спелла нет банка attackWitch`);
  }
}

// --- Школы ---
const secrets = getSchoolById("secrets");
check(secrets.unlockRule?.bridges === 2, "Школа тайн должна требовать 2 моста");
check(getSchoolById("earth").unlockRule === undefined, "Школа земли должна быть открыта по умолчанию");

// --- Мост ---
const bridge = ALL_SPELLS.find((s) => s.id === "machine_heart")!;
check(isBridgeSpell(bridge), "machine_heart должен быть мостом");
check(bridge.schools.length === 2 && bridge.schools.includes("earth"), "мост должен принадлежать двум школам");
check(
  getSpellsBySchool("earth").every((s) => !isBridgeSpell(s)),
  "мост не должен считаться в основной школе другой школы (только гхост)"
);

// --- GameState: прогресс и открытие школ ---
const state = new GameState();
check(state.isSchoolUnlocked("earth"), "земля открыта на старте");
check(state.isSchoolUnlocked("fire"), "огонь открыт на старте");
check(!state.isSchoolUnlocked("secrets"), "тайны закрыты на старте");
check(
  state.getSchoolProgress("earth").total === 6 && state.getSchoolProgress("earth").learned === 0,
  "прогресс земли 0/6 на старте"
);

check(state.isUnlockable(ALL_SPELLS.find((s) => s.id === "spark")!), "spark доступен на старте");
check(
  !state.isUnlockable(ALL_SPELLS.find((s) => s.id === "flame")!),
  "flame недоступен без spark"
);

// Изучаем единственный мост — тайны всё ещё закрыты (нужно 2).
state.learn("spark");
state.learn("flame");
state.learn("machine_heart");
check(state.getLearnedBridgeCount() === 1, `после одного моста: 1 мост, получил ${state.getLearnedBridgeCount()}`);
check(!state.isSchoolUnlocked("secrets"), "одного моста мало для тайн");
check(state.isUnlockable(ALL_SPELLS.find((s) => s.id === "flame")!) === false, "изученный flame снова не доступен");

// Прогресс школы после изучения
check(state.getSchoolProgress("fire").learned === 3, "прогресс огня 3/3 после изучения");

if (failures === 0) {
  console.log("OK: реестр заклинаний, школы и роли прошли проверки");
} else {
  console.error(`FAILED: ${failures} нарушений`);
  process.exit(1);
}