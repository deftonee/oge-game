// Модель данных заклинаний и школ. Данные — JSON-файлы в ./spells/*.json:
//   schools.json — метаданные школ (веток прокачки),
//   <school>.json — файл на школу со спеллами (добавил файл → появилась школа).
// Валидация всего набора происходит один раз при загрузке модуля и падает
// с понятной ошибкой (файл + спелл), а не молча.
//
// Каждое заклинание имеет ПУЛ вопросов и БАНКИ РОЛЕЙ — какие вопросы из пула
// используются в каком сценарии:
//   attackWitch  — атака ведьмы в дуэли (нужно только боевым темам),
//   defendWitch  — защита от атаки ведьмы её же темой (обязателен всем),
//   staticTarget — тренировка у чучела/дерева/крапивы и пробитие барьера (обязателен всем).
// Роль без банка = заклинание неприменимо в этом сценарии (fallback не делаем).

import schoolsJson from "./spells/schools.json";
import earthJson from "./spells/earth.json";
import fireJson from "./spells/fire.json";

// ---------- Типы ----------

export type QuestionRole = "attackWitch" | "defendWitch" | "staticTarget";

export const QUESTION_ROLES: readonly QuestionRole[] = ["attackWitch", "defendWitch", "staticTarget"];

export const ROLE_LABELS: Record<QuestionRole, string> = {
  attackWitch: "⚔️ атака ведьмы",
  defendWitch: "🛡️ защита от ведьмы",
  staticTarget: "🎯 тренировка у цели",
};

export interface SpellQuestion {
  id: string;
  text: string;
  answer: number;
  tolerance: number; // допустимая погрешность ответа
  unit: string; // единица измерения для подсказки игроку
}

export interface TutorialQuestions {
  simple: SpellQuestion; // этап 1 у костра: простейший пример на новую формулу
  harder: SpellQuestion; // этап 2 у костра: усложнённая задача (доп. шаг/конверсия единиц)
}

/** Банк ролей: роль -> id вопросов из пула заклинания. */
export type QuestionBank = Partial<Record<QuestionRole, string[]>>;

export interface Spell {
  id: string;
  name: string; // как называется заклинание в игре
  law: string; // человекочитаемое название закона физики
  formula: string; // формула, которая показывается игроку
  color: string; // акцентный цвет (эффекты и UI)
  tier: number; // порядок изучения ВНУТРИ школы (1 — самое простое)
  school: string; // основная школа (ид)
  schools: string[]; // все школы, которым принадлежит заклинание; >1 — мост
  prerequisites: string[]; // id заклинаний, которые нужно изучить раньше
  tutorial: TutorialQuestions;
  questions: SpellQuestion[]; // пул вопросов заклинания
  banks: QuestionBank; // какие вопросы пула в какой роли используются
}

export interface School {
  id: string;
  name: string; // «Школа земли»
  pathName: string; // «Путь Странника»
  icon: string; // эмодзи для UI
  color: string; // акцентный цвет ветки
  element: string; // образ раздела (для подсказок)
  description: string;
  unlockRule?: { bridges: number }; // сколько мостов нужно выучить, чтобы открыть школу
}

// ---------- Сырые JSON-структуры (валидируются ниже) ----------

interface RawSchoolFile {
  schools: RawSchool[];
}

interface RawSchool {
  id: string;
  name: string;
  pathName: string;
  icon: string;
  color: string;
  element?: string;
  description?: string;
  unlockRule?: { bridges: number };
}

interface RawSpellFile {
  school: string;
  spells: RawSpell[];
}

interface RawSpell {
  id: string;
  name: string;
  law: string;
  formula: string;
  color: string;
  tier: number;
  prerequisites?: string[];
  /** Мосты: явный список школ (первая — основная). Обычные спеллы — без поля. */
  schools?: string[];
  tutorial: { simple: SpellQuestion; harder: SpellQuestion };
  questions: SpellQuestion[];
  banks: QuestionBank;
}

// ---------- Валидация ----------

function fail(msg: string): never {
  throw new Error(`[spells] ${msg}`);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function checkQuestion(q: SpellQuestion, where: string): void {
  if (!q || typeof q.id !== "string" || q.id.length === 0) fail(`${where}: вопрос без id`);
  if (typeof q.text !== "string" || q.text.length === 0) fail(`${where} («${q.id}»): пустой текст`);
  if (!isFiniteNumber(q.answer)) fail(`${where} («${q.id}»): answer не число`);
  if (!isFiniteNumber(q.tolerance) || q.tolerance < 0) fail(`${where} («${q.id}»): tolerance не число >= 0`);
  if (typeof q.unit !== "string") fail(`${where} («${q.id}»): unit не строка`);
}

function validateSchools(raw: RawSchool[]): School[] {
  const schools: School[] = raw.map((s, i) => {
    const where = `schools.json[${i}] (${s?.id ?? "?"})`;
    if (!s || typeof s.id !== "string" || !s.id) fail(`${where}: нет id`);
    if (typeof s.name !== "string" || !s.name) fail(`${where}: нет name`);
    if (typeof s.pathName !== "string" || !s.pathName) fail(`${where}: нет pathName`);
    if (typeof s.color !== "string" || !s.color) fail(`${where}: нет color`);
    const rule = s.unlockRule;
    if (rule !== undefined && (!isFiniteNumber(rule.bridges) || !Number.isInteger(rule.bridges) || rule.bridges <= 0)) {
      fail(`${where}: unlockRule.bridges должен быть целым > 0`);
    }
    return {
      id: s.id,
      name: s.name,
      pathName: s.pathName,
      icon: s.icon ?? "❔",
      color: s.color,
      element: s.element ?? "",
      description: s.description ?? "",
      ...(rule ? { unlockRule: { bridges: rule.bridges } } : {}),
    };
  });

  const ids = new Set<string>();
  for (const s of schools) {
    if (ids.has(s.id)) fail(`schools.json: дубликат школы «${s.id}»`);
    ids.add(s.id);
  }
  return schools;
}

/** Валидирует спеллы одного файла школы и нормализует их (schools = [primary]). */
function validateSpellFile(file: RawSpellFile, schoolIds: Set<string>): Spell[] {
  const where = `${file.school}.json`;
  if (typeof file.school !== "string" || !file.school) fail(`${where}: нет поля school`);
  if (!schoolIds.has(file.school)) fail(`${where}: школа «${file.school}» не объявлена в schools.json`);
  if (!Array.isArray(file.spells)) fail(`${where}: нет массива spells`);

  return file.spells.map((s) => {
    const ctx = `${where} / ${s?.id ?? "?"}`;
    if (!s || typeof s.id !== "string" || !s.id) fail(`${where}: спелл без id`);
    for (const field of ["name", "law", "formula", "color"] as const) {
      if (typeof s[field] !== "string" || !s[field]) fail(`${ctx}: нет поля ${field}`);
    }
    if (!isFiniteNumber(s.tier) || !Number.isInteger(s.tier) || s.tier < 1) fail(`${ctx}: tier должен быть целым >= 1`);
    if (!s.tutorial || !s.tutorial.simple || !s.tutorial.harder) fail(`${ctx}: нет tutorial (simple/harder)`);
    checkQuestion(s.tutorial.simple, `${ctx} tutorial.simple`);
    checkQuestion(s.tutorial.harder, `${ctx} tutorial.harder`);
    if (!Array.isArray(s.questions) || s.questions.length === 0) fail(`${ctx}: пустой пул questions`);
    s.questions.forEach((q, i) => checkQuestion(q, `${ctx} questions[${i}]`));

    // Школы: по умолчанию только своя; явный список — мост (все школы должны существовать).
    const schools = s.schools ?? [file.school];
    if (!Array.isArray(schools) || schools.length === 0) fail(`${ctx}: пустой список schools`);
    if (!schools.includes(file.school)) fail(`${ctx}: schools не содержит основную школу файла «${file.school}»`);
    for (const sc of schools) {
      if (!schoolIds.has(sc)) fail(`${ctx}: школа «${sc}» из списка schools не объявлена в schools.json`);
    }

    const poolIds = new Set<string>();
    for (const q of s.questions) {
      if (poolIds.has(q.id)) fail(`${ctx}: дубликат вопроса «${q.id}» в пуле`);
      poolIds.add(q.id);
    }

    // Обязательные роли: защита от ведьмы и тренировка у цели должны быть у каждого.
    for (const role of ["defendWitch", "staticTarget"] as const) {
      const bank = s.banks?.[role];
      if (!Array.isArray(bank) || bank.length === 0) fail(`${ctx}: обязательный банк «${role}» пуст или отсутствует`);
    }
    for (const role of QUESTION_ROLES) {
      const bank = s.banks?.[role];
      if (bank === undefined) continue;
      if (!Array.isArray(bank)) fail(`${ctx}: банк «${role}» не массив`);
      for (const qid of bank) {
        if (!poolIds.has(qid)) fail(`${ctx}: банк «${role}» ссылается на неизвестный вопрос «${qid}»`);
      }
    }

    return {
      id: s.id,
      name: s.name,
      law: s.law,
      formula: s.formula,
      color: s.color,
      tier: s.tier,
      school: file.school,
      schools,
      prerequisites: s.prerequisites ?? [],
      tutorial: { simple: s.tutorial.simple, harder: s.tutorial.harder },
      questions: s.questions,
      banks: s.banks,
    };
  });
}

function buildRegistry(): { schools: School[]; spells: Spell[] } {
  const schools = validateSchools((schoolsJson as RawSchoolFile).schools);
  const schoolIds = new Set(schools.map((s) => s.id));

  const fileSources: Record<string, RawSpellFile> = {
    earth: earthJson as RawSpellFile,
    fire: fireJson as RawSpellFile,
  };
  // Дополняемость: для новой школы добавляется одна строка ниже (и JSON-файл).

  const spells = Object.values(fileSources).flatMap((file) => validateSpellFile(file, schoolIds));

  // Глобальные проверки: уникальность id, существование пререквизитов, рефы школ мостов.
  const byId = new Map<string, Spell>();
  for (const s of spells) {
    if (byId.has(s.id)) fail(`дубликат заклинания «${s.id}» между школами`);
    byId.set(s.id, s);
  }
  for (const s of spells) {
    for (const prereq of s.prerequisites) {
      if (!byId.has(prereq)) fail(`«${s.id}»: пререквизит «${prereq}» не найден`);
      if (prereq === s.id) fail(`«${s.id}»: пререквизит сам на себя`);
    }
  }
  return { schools, spells };
}

const registry = buildRegistry();

// ---------- Публичный доступ ----------

/** Все школы в порядке объявления (порядок колонок в графе). */
export const ALL_SCHOOLS: readonly School[] = registry.schools;

/** Все заклинания всех школ. */
export const ALL_SPELLS: readonly Spell[] = registry.spells;

export function getSchoolById(id: string): School {
  const school = ALL_SCHOOLS.find((s) => s.id === id);
  if (!school) throw new Error(`[spells] Неизвестная школа: ${id}`);
  return school;
}

export function getSpellById(id: string): Spell {
  const spell = ALL_SPELLS.find((s) => s.id === id);
  if (!spell) throw new Error(`[spells] Неизвестное заклинание: ${id}`);
  return spell;
}

/** Спеллы, принадлежащие школе по ОСНОВНОЙ школе. Мост считается в своей основной. */
export function getSpellsBySchool(schoolId: string): Spell[] {
  return ALL_SPELLS.filter((s) => s.school === schoolId);
}

/** Мост — заклинание на стыке двух школ (schools.length > 1). */
export function isBridgeSpell(spell: Spell): boolean {
  return spell.schools.length > 1;
}

/** Изученные мосты нужны для открытия Школы тайн. */
export function getBridgeSpells(): Spell[] {
  return ALL_SPELLS.filter(isBridgeSpell);
}

export function schoolOf(spell: Spell): School {
  return getSchoolById(spell.school);
}

/** Есть ли у заклинания вопросы для роли (роль применима в этом сценарии). */
export function hasQuestionRole(spell: Spell, role: QuestionRole): boolean {
  const bank = spell.banks[role];
  return Array.isArray(bank) && bank.length > 0;
}

/** Вопросы заклинания для роли. Вызывать только если hasQuestionRole(spell, role). */
export function questionsFor(spell: Spell, role: QuestionRole): SpellQuestion[] {
  const bank = spell.banks[role];
  if (!bank) return [];
  const byId = new Map(spell.questions.map((q) => [q.id, q]));
  const resolved: SpellQuestion[] = [];
  for (const id of bank) {
    const q = byId.get(id);
    if (q) resolved.push(q);
  }
  return resolved;
}

// С этапа 5 (костры) игрок не знает заклинаний с самого начала. Массив оставлен
// пустым, но сохранён как точка расширения (например, для будущего выбора
// стартовой специализации).
export const STARTER_SPELL_IDS: string[] = [];