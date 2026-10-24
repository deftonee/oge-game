// Модель боя без UI и сцены: шкала Силы, усталость заклинаний, формула урона.
// Запуск: npm run test:combat-model.
declare const process: { exit(code?: number): never };

import { PowerPool } from "../src/combat/PowerPool";
import { SpellFatigue, fatigueMultiplier, DEFAULT_FATIGUE } from "../src/combat/SpellFatigue";
import { spellDamage } from "../src/combat/damage";
import {
  FATIGUE_WINDOW,
  PLAYER_MAX_POWER,
  SPELL_BASE_DAMAGE,
  TRAINING_WITCH_POWER,
  WITCH_HIT_DAMAGE,
  WITCH_POWER,
} from "../src/combat/combatBalance";

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  }
}

// --- PowerPool ---------------------------------------------------------------------
{
  const p = new PowerPool(100);
  check(p.current === 100 && p.fraction === 1 && p.isFull && !p.isDepleted, "новая шкала полная");
  check(p.drain(30) === 30 && p.current === 70, "drain снимает указанное");
  check(p.drain(500) === 70 && p.current === 0 && p.isDepleted, "drain не уходит в минус и возвращает реально снятое");
  check(p.drain(10) === 0, "из пустой шкалы снимать нечего");
  check(p.drain(-5) === 0 && p.drain(NaN) === 0 && p.current === 0, "отрицательное и NaN не меняют шкалу");
  p.recover(25);
  check(p.current === 25, "recover прибавляет");
  p.recover(1000);
  check(p.current === 100 && p.isFull, "recover не превышает максимум");
  p.recover(-10);
  p.recover(NaN);
  check(p.current === 100, "мусор в recover игнорируется");
  p.drain(60);
  p.restore();
  check(p.isFull, "restore наполняет шкалу");

  const half = new PowerPool(80, 40);
  check(half.current === 40 && half.fraction === 0.5, "стартовое значение и доля");
  check(new PowerPool(10, 999).current === 10 && new PowerPool(10, -3).current === 0, "стартовое значение зажато в границы");
  let threw = false;
  try {
    new PowerPool(0);
  } catch {
    threw = true;
  }
  check(threw, "максимум 0 — ошибка");

  const q = new PowerPool(50);
  let calls = 0;
  const off = q.subscribe(() => calls++);
  q.drain(10);
  q.drain(0);
  q.recover(0);
  check(calls === 1, `подписчик зовётся только при реальном изменении (вызовов ${calls})`);
  q.restore();
  q.restore();
  check(calls === 2, "повторный restore ничего не меняет — подписчик молчит");
  off();
  q.drain(5);
  check(calls === 2, "после отписки подписчик не вызывается");
}

// --- fatigueMultiplier / SpellFatigue --------------------------------------------------
{
  const cfg = DEFAULT_FATIGUE;
  check(fatigueMultiplier(1) === 1 && fatigueMultiplier(cfg.freeUses) === 1, "бесплатные применения бьют на полную");
  check(Math.abs(fatigueMultiplier(cfg.freeUses + 1) - (1 - cfg.step)) < 1e-9, "первое применение сверх бесплатных слабее на шаг");
  check(fatigueMultiplier(cfg.freeUses + 2) < fatigueMultiplier(cfg.freeUses + 1), "дальше — ещё слабее");
  check(fatigueMultiplier(1000) === cfg.minMultiplier, "нижняя граница множителя");

  const f = new SpellFatigue();
  check(f.multiplierFor("a") === 1 && f.usesInWindow("a") === 0, "свежая память: заклинание не устало");

  // Одно и то же заклинание подряд: множитель монотонно падает до пола.
  let prev = 2;
  let monotone = true;
  const seen: number[] = [];
  for (let i = 0; i < 12; i++) {
    const m = f.multiplierFor("a");
    seen.push(m);
    if (m > prev + 1e-9) monotone = false;
    prev = m;
    f.record("a");
  }
  check(monotone, `спам одним заклинанием: множитель не растёт (${seen.map((x) => x.toFixed(2)).join(" ")})`);
  check(seen[0] === 1 && seen[seen.length - 1] === cfg.minMultiplier, "спам: от полного урона до пола");
  check(f.snapshot().length === FATIGUE_WINDOW, "окно памяти ограничено");

  // Другое заклинание при этом не устало.
  check(f.multiplierFor("b") === 1, "другое заклинание в полной силе");

  // Чередование восстанавливает: окно вытесняет старые применения.
  for (let i = 0; i < FATIGUE_WINDOW; i++) f.record("b");
  check(f.usesInWindow("a") === 0 && f.multiplierFor("a") === 1, "после череды других заклинаний первое отдохнуло");

  // Чем больше разных заклинаний, тем меньше усталость при равномерном чередовании.
  const steadyState = (spells: string[]): number => {
    const mem = new SpellFatigue();
    for (let i = 0; i < 40; i++) mem.record(spells[i % spells.length]);
    return mem.multiplierFor(spells[0]);
  };
  const m1 = steadyState(["a"]);
  const m2 = steadyState(["a", "b"]);
  const m3 = steadyState(["a", "b", "c"]);
  const m4 = steadyState(["a", "b", "c", "d"]);
  check(m1 < m2 && m2 < m3 && m3 <= m4, `больше заклинаний — меньше усталость (${[m1, m2, m3, m4].map((x) => x.toFixed(2)).join(" < ")})`);
  check(m4 === 1, "четырьмя заклинаниями по кругу можно бить на полную");
  check(m3 >= 0.8 && m2 <= 0.6 && m1 === cfg.minMultiplier, `тремя — почти полная, двумя — заметно слабее, одним — пол (${m3} / ${m2} / ${m1})`);

  f.reset();
  check(f.snapshot().length === 0 && f.multiplierFor("a") === 1, "reset забывает всё");

  const custom = new SpellFatigue({ window: 3, freeUses: 0, step: 0.5, minMultiplier: 0.1 });
  custom.record("x");
  check(custom.multiplierFor("x") === 0.1, "своя конфигурация: пол 0.1");
}

// --- spellDamage ----------------------------------------------------------------------
{
  check(spellDamage({ mastery: 0, fatigueMultiplier: 1 }) === SPELL_BASE_DAMAGE, "базовый урон без мастерства и усталости");
  check(spellDamage({ mastery: 5, fatigueMultiplier: 1 }) > spellDamage({ mastery: 0, fatigueMultiplier: 1 }), "мастерство усиливает удар");
  check(spellDamage({ mastery: 0, fatigueMultiplier: 0.5 }) === SPELL_BASE_DAMAGE / 2, "усталость ослабляет удар");
  check(spellDamage({ mastery: 0, fatigueMultiplier: 0 }) === 1, "урон не бывает меньше 1 (бой всегда заканчивается)");
  check(spellDamage({ mastery: -3, fatigueMultiplier: 1 }) === SPELL_BASE_DAMAGE, "отрицательное мастерство не ослабляет");
  check(Number.isInteger(spellDamage({ mastery: 3, fatigueMultiplier: 0.6 })), "урон целый");
}

// --- Баланс: опорные соотношения ----------------------------------------------------
{
  check(Math.ceil(WITCH_POWER / SPELL_BASE_DAMAGE) === 3, "обычная ведьма — три верных удара без усталости");
  check(Math.ceil(PLAYER_MAX_POWER / WITCH_HIT_DAMAGE) === 3, "игрок выдерживает три неотражённых удара");
  check(TRAINING_WITCH_POWER <= SPELL_BASE_DAMAGE, "тренировочная ведьма падает с одного удара");

  // Бить одним заклинанием можно, но повторные бои становятся длиннее: память об усталости общая.
  const mem = new SpellFatigue();
  const hitsToBeat = (): number => {
    const power = new PowerPool(WITCH_POWER);
    let hits = 0;
    while (!power.isDepleted && hits < 50) {
      power.drain(spellDamage({ mastery: 0, fatigueMultiplier: mem.multiplierFor("a") }));
      mem.record("a");
      hits++;
    }
    return hits;
  };
  const first = hitsToBeat();
  const second = hitsToBeat();
  check(first === 3, `первый бой свежим заклинанием — три удара (${first})`);
  check(second > first, `повторный бой тем же заклинанием длиннее (${first} → ${second})`);
}

if (failures === 0) {
  console.log(`OK: модель боя — ${checks} проверок (Сила, усталость заклинаний, урон)`);
} else {
  console.error(`FAILED: ${failures} из ${checks}`);
  process.exit(1);
}
