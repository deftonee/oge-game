// Модель данных для заклинаний (законов физики) и задач к ним.
// В минимальном срезе — один изученный спелл с банком простых вопросов.
// Дальше (этап 4-5) сюда добавится граф с prerequisites и уровнями мастерства.

export interface SpellQuestion {
  id: string;
  text: string;
  answer: number;
  tolerance: number; // допустимая погрешность ответа
  unit: string; // единица измерения для подсказки игроку
}

export interface Spell {
  id: string;
  name: string; // как называется заклинание в игре
  law: string; // человекочитаемое название закона физики
  formula: string; // формула, которая показывается игроку
  color: string; // акцентный цвет заклинания (для эффектов и UI)
  tier: number; // 1 — самое простое, дальше сложнее (для раскладки графа)
  prerequisites: string[]; // id заклинаний, которые нужно изучить раньше
  tutorial: {
    simple: SpellQuestion; // этап 1 у костра: простейший пример на новую формулу
    harder: SpellQuestion; // этап 2 у костра: усложнённая задача (доп. шаг/конверсия единиц)
  };
  questions: SpellQuestion[]; // банк вопросов для боя (после того как заклинание изучено)
}

// --- Тир 1: стартовые темы, без пререквизитов ---

const SPELL_VELOCITY: Spell = {
  id: "velocity",
  name: "Стрела Скорости",
  law: "Равномерное прямолинейное движение",
  formula: "v = s / t",
  color: "#4fd6c8",
  tier: 1,
  prerequisites: [],
  tutorial: {
    simple: { id: "v-t1", text: "Тело прошло путь 6 м за 3 с. Найди скорость.", answer: 2, tolerance: 0.01, unit: "м/с" },
    harder: {
      id: "v-t2",
      text: "Автомобиль едет со скоростью 90 км/ч. Сколько метров он проедет за 10 секунд? (переведи км/ч в м/с)",
      answer: 250,
      tolerance: 1,
      unit: "м",
    },
  },
  questions: [
    { id: "v1", text: "Тело прошло путь 10 м за 2 с. Найди скорость.", answer: 5, tolerance: 0.01, unit: "м/с" },
    { id: "v2", text: "Поезд прошёл 120 км за 2 часа. Найди скорость.", answer: 60, tolerance: 0.5, unit: "км/ч" },
    { id: "v3", text: "Скорость тела 4 м/с, время движения 5 с. Найди путь.", answer: 20, tolerance: 0.01, unit: "м" },
    { id: "v4", text: "Путь 100 м, скорость 25 м/с. За сколько секунд пройден путь?", answer: 4, tolerance: 0.01, unit: "с" },
  ],
};

const SPELL_DENSITY: Spell = {
  id: "density",
  name: "Зов Плотности",
  law: "Плотность вещества",
  formula: "ρ = m / V",
  color: "#8fd14f",
  tier: 1,
  prerequisites: [],
  tutorial: {
    simple: { id: "d-t1", text: "Масса тела 20 г, объём 4 см³. Найди плотность.", answer: 5, tolerance: 0.01, unit: "г/см³" },
    harder: {
      id: "d-t2",
      text: "Кусок металла объёмом 50 см³ имеет плотность 8 г/см³. Найди массу в килограммах (переведи граммы в кг).",
      answer: 0.4,
      tolerance: 0.01,
      unit: "кг",
    },
  },
  questions: [
    { id: "d1", text: "Масса тела 200 г, объём 40 см³. Найди плотность.", answer: 5, tolerance: 0.01, unit: "г/см³" },
    { id: "d2", text: "Плотность вещества 2,7 г/см³, объём 10 см³. Найди массу.", answer: 27, tolerance: 0.1, unit: "г" },
    { id: "d3", text: "Масса бруска 500 г, плотность вещества 2,5 г/см³. Найди объём.", answer: 200, tolerance: 0.5, unit: "см³" },
  ],
};

// --- Тир 2: требуют изученной темы тира 1 ---

const SPELL_ACCELERATION: Spell = {
  id: "acceleration",
  name: "Клинок Ускорения",
  law: "Равноускоренное движение (из состояния покоя)",
  formula: "a = v / t",
  color: "#ff9f4f",
  tier: 2,
  prerequisites: ["velocity"],
  tutorial: {
    simple: { id: "a-t1", text: "Тело разогналось из покоя до 10 м/с за 5 с. Найди ускорение.", answer: 2, tolerance: 0.01, unit: "м/с²" },
    harder: {
      id: "a-t2",
      text: "Автомобиль трогается с места и набирает скорость 72 км/ч за 4 с. Найди ускорение в м/с² (переведи км/ч в м/с).",
      answer: 5,
      tolerance: 0.05,
      unit: "м/с²",
    },
  },
  questions: [
    { id: "a1", text: "Тело разогналось из покоя до 20 м/с за 4 с. Найди ускорение.", answer: 5, tolerance: 0.01, unit: "м/с²" },
    { id: "a2", text: "Ускорение тела 2 м/с², время разгона из покоя — 5 с. Найди конечную скорость.", answer: 10, tolerance: 0.01, unit: "м/с" },
    { id: "a3", text: "Скорость выросла с 0 до 12 м/с за 3 с. Найди ускорение.", answer: 4, tolerance: 0.01, unit: "м/с²" },
  ],
};

const SPELL_FORCE: Spell = {
  id: "force",
  name: "Хватка Силы",
  law: "Второй закон Ньютона",
  formula: "F = m · a",
  color: "#ff6b5e",
  tier: 2,
  prerequisites: ["acceleration"],
  tutorial: {
    simple: { id: "f-t1", text: "Масса тела 3 кг, ускорение 2 м/с². Найди силу.", answer: 6, tolerance: 0.01, unit: "Н" },
    harder: {
      id: "f-t2",
      text: "Тело массой 500 г получило ускорение 4 м/с². Найди силу в ньютонах (переведи граммы в кг).",
      answer: 2,
      tolerance: 0.05,
      unit: "Н",
    },
  },
  questions: [
    { id: "f1", text: "Масса тела 2 кг, ускорение 3 м/с². Найди силу.", answer: 6, tolerance: 0.01, unit: "Н" },
    { id: "f2", text: "Сила 20 Н действует на тело массой 4 кг. Найди ускорение.", answer: 5, tolerance: 0.01, unit: "м/с²" },
    { id: "f3", text: "Масса тела 5 кг, ускорение 2 м/с². Найди силу.", answer: 10, tolerance: 0.01, unit: "Н" },
  ],
};

// --- Тир 3: сложные темы на стыке предыдущих (материал для комбо мини-боссов) ---

const SPELL_PRESSURE: Spell = {
  id: "pressure",
  name: "Гнёт Давления",
  law: "Давление твёрдых тел",
  formula: "p = F / S",
  color: "#b06fe0",
  tier: 3,
  prerequisites: ["force", "density"],
  tutorial: {
    simple: { id: "p-t1", text: "Сила давления 40 Н действует на площадь 2 м². Найди давление.", answer: 20, tolerance: 0.5, unit: "Па" },
    harder: {
      id: "p-t2",
      text: "Груз массой 10 кг давит на опору площадью 0,5 м². Найди давление (считай g = 10 Н/кг, сначала найди силу тяжести).",
      answer: 200,
      tolerance: 2,
      unit: "Па",
    },
  },
  questions: [
    { id: "p1", text: "Сила давления 100 Н действует на площадь 2 м². Найди давление.", answer: 50, tolerance: 0.5, unit: "Па" },
    { id: "p2", text: "Давление 25 Па, площадь опоры 4 м². Найди силу давления.", answer: 100, tolerance: 1, unit: "Н" },
    { id: "p3", text: "Сила 60 Н создаёт давление 20 Па. Найди площадь.", answer: 3, tolerance: 0.05, unit: "м²" },
  ],
};

const SPELL_WORK: Spell = {
  id: "work",
  name: "Печать Работы",
  law: "Механическая работа",
  formula: "A = F · s",
  color: "#ffd24f",
  tier: 3,
  prerequisites: ["force"],
  tutorial: {
    simple: { id: "w-t1", text: "Сила 5 Н переместила тело на 4 м. Найди работу.", answer: 20, tolerance: 0.5, unit: "Дж" },
    harder: {
      id: "w-t2",
      text: "Груз массой 2 кг подняли на высоту 3 м (g = 10 Н/кг). Найди работу по подъёму (сначала найди силу тяжести).",
      answer: 60,
      tolerance: 1,
      unit: "Дж",
    },
  },
  questions: [
    { id: "w1", text: "Сила 10 Н переместила тело на 5 м. Найди работу.", answer: 50, tolerance: 0.5, unit: "Дж" },
    { id: "w2", text: "Работа 100 Дж выполнена силой 20 Н. Найди пройденный путь.", answer: 5, tolerance: 0.05, unit: "м" },
    { id: "w3", text: "Тело прошло 4 м под действием силы 15 Н. Найди работу.", answer: 60, tolerance: 0.5, unit: "Дж" },
  ],
};

/** Полный граф заклинаний, отсортирован тирами от простого к сложному. */
export const ALL_SPELLS: Spell[] = [
  SPELL_VELOCITY,
  SPELL_DENSITY,
  SPELL_ACCELERATION,
  SPELL_FORCE,
  SPELL_PRESSURE,
  SPELL_WORK,
];

export function getSpellById(id: string): Spell {
  const spell = ALL_SPELLS.find((s) => s.id === id);
  if (!spell) throw new Error(`Unknown spell id: ${id}`);
  return spell;
}

// С этапа 5 (костры) игрок не знает заклинаний с самого начала — даже
// "Скорость" нужно изучить у первого костра. Массив оставлен пустым, но
// сохранён как точка расширения (например, для будущего выбора стартовой
// специализации).
export const STARTER_SPELL_IDS: string[] = [];
