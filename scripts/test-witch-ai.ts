/**
 * test-witch-ai.ts — «мозг» ведьмы (src/ai/witchBrain.ts) без Babylon.
 * Симулируем кадры по 1/60 с и проверяем поведение:
 *  - стоит/гуляет вперемешку и не уходит дальше радиуса прогулки от дома;
 *  - зрение: конус, дальность, невидимость в кусте, стены/препятствия (LOS), friendly не замечает;
 *  - заметив игрока, замирает на «паузу узнавания», потом медленно идёт к нему;
 *  - игрок спрятался → ведьма идёт к месту пропажи, пару секунд бродит рядом,
 *    теряет интерес, возвращается домой и снова стоит/гуляет;
 *  - игрок ушёл за границу секции → ведьма стоит и смотрит, потом теряет интерес;
 *  - разнообразие: у ведьм разный характер, погони и поиски не повторяют друг друга;
 *  - после дуэли (disengage) игрока некоторое время не замечает; поводок; застревание.
 */
import {
  WitchBrain,
  DEFAULT_WITCH_AI,
  NEUTRAL_TRAITS,
  type WitchAiInput,
  type WitchAiState,
  type WitchTraits,
} from "../src/ai/witchBrain";
import { mulberry32 } from "../src/world/math/Rng";

let failures = 0;
let checks = 0;
function check(cond: boolean, msg: string): void {
  checks++;
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  }
}

const DT = 1 / 60;
const CFG = DEFAULT_WITCH_AI;
const PLAYER_SPEED = 6.5;
/** Верхняя граница скорости погони: базовая × максимум характера × максимум «плавания». */
const MAX_CHASE_SPEED = CFG.chaseSpeed * 1.25 * CFG.wobbleMax;

interface World {
  x: number;
  z: number;
  px: number;
  pz: number;
  hidden: boolean;
  losClear: boolean;
  canDetect: boolean;
  /** Игрок в секции ведьмы (false — за границей). */
  inTerritory: boolean;
  /** Эмуляция стены: ведьма не двигается. */
  blocked: boolean;
}

function makeWorld(): World {
  return { x: 0, z: 0, px: 0, pz: 0, hidden: false, losClear: true, canDetect: true, inTerritory: true, blocked: false };
}

interface Frame {
  speed: number;
  state: WitchAiState;
}

/** Один кадр: мозг → движение по заказанной скорости (если не заблокирована). */
function step(brain: WitchBrain, w: World): Frame {
  const inp: WitchAiInput = {
    x: w.x,
    z: w.z,
    playerX: w.px,
    playerZ: w.pz,
    playerHidden: w.hidden,
    canDetect: w.canDetect,
    playerInTerritory: w.inTerritory,
    lineOfSight: () => w.losClear,
  };
  const out = brain.tick(DT, inp);
  if (!w.blocked) {
    w.x += out.vx * DT;
    w.z += out.vz * DT;
  }
  return { speed: Math.hypot(out.vx, out.vz), state: out.state };
}

function run(brain: WitchBrain, w: World, seconds: number, onFrame?: (f: Frame, t: number) => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    // step() обязан вызываться ВСЕГДА (а не внутри onFrame?.(...), где без колбэка он бы не исполнился).
    const frame = step(brain, w);
    onFrame?.(frame, i * DT);
  }
}

/** Ждёт, пока мозг не окажется в нужном состоянии (до limit секунд); возвращает true, если дождался. */
function runUntil(brain: WitchBrain, w: World, state: WitchAiState, limit: number): boolean {
  const n = Math.round(limit / DT);
  for (let i = 0; i < n; i++) {
    step(brain, w);
    if (brain.state === state) return true;
  }
  return false;
}

/** Ведьма в (0,0), смотрит строго +Z, дом там же; rng детерминирован; по умолчанию без случайного характера. */
function makeBrain(seed = 1, yaw = 0, traits: Partial<WitchTraits> | "random" = NEUTRAL_TRAITS): WitchBrain {
  // "random" — характер разыгрывается из seed (а не undefined: он бы подставил значение по умолчанию).
  return new WitchBrain(0, 0, yaw, mulberry32(seed), {}, traits === "random" ? undefined : traits);
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const stdev = (a: number[]) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));

// ---------------------------------------------------------------------------
// 1. Прогулка: стоит ↔ гуляет, в пределах радиуса, медленно.
// ---------------------------------------------------------------------------
{
  let sawIdle = false;
  let sawWander = false;
  let maxDist = 0;
  let maxSpeed = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const brain = makeBrain(seed, 0, "random"); // со случайным характером
    const w = makeWorld();
    w.px = 500; // игрок далеко
    w.pz = 500;
    run(brain, w, 300, (f) => {
      if (f.state === "idle") sawIdle = true;
      if (f.state === "wander") sawWander = true;
      maxDist = Math.max(maxDist, Math.hypot(w.x - brain.homeX, w.z - brain.homeZ));
      maxSpeed = Math.max(maxSpeed, f.speed);
    });
  }
  check(sawIdle && sawWander, "ведьма должна и стоять, и гулять");
  check(maxDist <= CFG.wanderRadius + 0.5, `ушла от дома на ${maxDist.toFixed(2)} м (радиус ${CFG.wanderRadius})`);
  check(maxSpeed <= CFG.wanderSpeed + 1e-9, `прогулочная скорость ${maxSpeed.toFixed(2)} > ${CFG.wanderSpeed}`);
}

// ---------------------------------------------------------------------------
// 2. Зрение: конус, дальность, спина, куст, препятствие, friendly, чужая секция.
// ---------------------------------------------------------------------------
{
  const noticedAt = (px: number, pz: number, mut?: (w: World) => void): boolean => {
    const brain = makeBrain(3, 0); // смотрит в +Z
    const w = makeWorld();
    w.px = px;
    w.pz = pz;
    mut?.(w);
    // Фиксируем курс и проверяем реакцию сразу: заметила → замирает на узнавание (notice).
    return step(brain, w).state === "notice";
  };
  const halfFov = CFG.fov / 2;
  const at = (angle: number, dist: number) => [Math.sin(angle) * dist, Math.cos(angle) * dist] as const;

  check(noticedAt(...at(0, 6)), "прямо перед ней на 6 м — видит");
  check(noticedAt(...at(halfFov - 0.05, 6)), "у края конуса (внутри) — видит");
  check(!noticedAt(...at(halfFov + 0.12, 6)), "чуть за краем конуса — не видит");
  check(!noticedAt(...at(Math.PI / 2, 6)), "сбоку (90°) — не видит");
  check(!noticedAt(...at(Math.PI, 3)), "за спиной даже в 3 м — не видит");
  check(!noticedAt(...at(0, CFG.viewRange + 1)), "дальше дальности обзора — не видит");
  check(noticedAt(...at(0, CFG.viewRange - 0.5)), "у границы дальности (внутри) — видит");
  check(!noticedAt(...at(0, 2), (w) => (w.hidden = true)), "в кусте — невидим даже в упор");
  check(!noticedAt(...at(0, 6), (w) => (w.losClear = false)), "препятствие/стена на линии взгляда — не видит");
  check(!noticedAt(...at(0, 6), (w) => (w.canDetect = false)), "дружелюбная — не замечает");
  check(!noticedAt(...at(0, 6), (w) => (w.inTerritory = false)), "спокойная ведьма не реагирует на игрока за границей секции");
  check(CFG.fov < Math.PI * 0.6, "угол обзора должен быть не очень широким (< 108°)");
}

// ---------------------------------------------------------------------------
// 3. Узнавание и погоня: пауза, потом медленно к игроку, останавливается рядом.
// ---------------------------------------------------------------------------
{
  const brain = makeBrain(5, 0);
  const w = makeWorld();
  w.pz = 8; // стоит в 8 м прямо перед ведьмой, не двигается
  let maxSpeed = 0;
  let firstNotice = -1;
  let firstChase = -1;
  let walkedWhileNoticing = false;
  run(brain, w, 12, (f, t) => {
    if (f.state === "notice") {
      if (firstNotice < 0) firstNotice = t;
      if (f.speed > 0) walkedWhileNoticing = true;
    }
    if (f.state === "chase" && firstChase < 0) firstChase = t;
    maxSpeed = Math.max(maxSpeed, f.speed);
  });
  check(firstNotice >= 0 && firstNotice < 0.1, "заметила сразу, как игрок вошёл в конус");
  check(!walkedWhileNoticing, "во время паузы узнавания ведьма стоит на месте");
  const pause = firstChase - firstNotice;
  check(pause >= CFG.reactionMin - 0.05 && pause <= CFG.reactionMax + 0.1, `пауза узнавания ${pause.toFixed(2)} с вне [${CFG.reactionMin}; ${CFG.reactionMax}]`);
  check(maxSpeed <= MAX_CHASE_SPEED + 1e-9, `скорость погони ${maxSpeed.toFixed(2)} > ${MAX_CHASE_SPEED.toFixed(2)}`);
  check(MAX_CHASE_SPEED < PLAYER_SPEED / 1.8, "погоня должна быть заметно медленнее игрока даже на максимуме");
  const d = Math.hypot(w.px - w.x, w.pz - w.z);
  check(d <= CFG.chaseStopDistance + 0.2 && d >= CFG.chaseStopDistance - 0.5, `подошла на ${d.toFixed(2)} м (стоп-дистанция ${CFG.chaseStopDistance})`);
  check(brain.state === "chase", "пока игрок рядом и виден — остаётся в погоне");
}

// ---------------------------------------------------------------------------
// 4. Игрок убежал: ведьма не догоняет, теряет его.
// ---------------------------------------------------------------------------
{
  const brain = makeBrain(6, 0);
  const w = makeWorld();
  w.pz = 6;
  check(runUntil(brain, w, "chase", 2), "сначала погоня");
  let gaveUp = false;
  run(brain, w, 30, (f) => {
    w.pz += PLAYER_SPEED * DT; // убегает по прямой с игровой скоростью
    if (f.state === "search" || f.state === "return" || f.state === "watch") gaveUp = true;
  });
  check(gaveUp, "убежавшего игрока ведьма в итоге теряет");
}

// ---------------------------------------------------------------------------
// 5. Куст: спрятался во время погони → search → пару секунд рядом → домой → idle.
// ---------------------------------------------------------------------------
{
  let allOk = true;
  for (let seed = 1; seed <= 10; seed++) {
    const brain = makeBrain(seed, 0);
    const w = makeWorld();
    w.pz = 7;
    if (!runUntil(brain, w, "chase", 3)) {
      allOk = false;
      check(false, `seed ${seed}: нет погони перед укрытием`);
      continue;
    }
    w.hidden = true; // нырнул в куст
    const bush = { x: w.px, z: w.pz };

    let t = 0;
    let searchStart = -1;
    let lingerNearBush = 0; // секунды в search ближе 3.8 м к кусту
    let returnStart = -1;
    let backIdle = -1;
    let reChase = false;
    let minDistFromBushInSearch = Infinity;
    run(brain, w, 40, (f) => {
      t += DT;
      if (f.state === "chase" && searchStart >= 0) reChase = true;
      if (f.state === "search" && searchStart < 0) searchStart = t;
      if (f.state === "search") {
        const d = Math.hypot(w.x - bush.x, w.z - bush.z);
        if (d <= CFG.searchRingMax + 0.8) lingerNearBush += DT;
        minDistFromBushInSearch = Math.min(minDistFromBushInSearch, d);
      }
      if (f.state === "return" && returnStart < 0) returnStart = t;
      if ((f.state === "idle" || f.state === "wander") && returnStart >= 0 && backIdle < 0) backIdle = t;
    });

    const ok =
      searchStart >= 0 &&
      !reChase &&
      returnStart > searchStart &&
      backIdle > returnStart &&
      lingerNearBush >= CFG.searchLingerMin - 0.2 &&
      lingerNearBush <= CFG.searchLingerMax + CFG.scanMax + 5.5 &&
      Math.hypot(w.x - brain.homeX, w.z - brain.homeZ) <= CFG.wanderRadius + 0.6;
    if (!ok) {
      allOk = false;
      console.error(
        `  seed ${seed}: search@${searchStart.toFixed(1)} return@${returnStart.toFixed(1)} idle@${backIdle.toFixed(1)} lingerNear=${lingerNearBush.toFixed(1)} reChase=${reChase} dist=${Math.hypot(w.x, w.z).toFixed(1)}`
      );
    }
    // Не лезет в сам куст: ближе кольца поиска (с небольшим допуском) не подходит.
    check(
      minDistFromBushInSearch >= CFG.chaseStopDistance - 0.3,
      `seed ${seed}: при поиске подошла к кусту на ${minDistFromBushInSearch.toFixed(2)} м (не ближе ${CFG.chaseStopDistance - 0.3})`
    );
  }
  check(allOk, "куст: ведьма теряет игрока, бродит рядом пару секунд, возвращается домой и успокаивается");
}

// ---------------------------------------------------------------------------
// 6. Вышел из куста на виду → снова погоня.
// ---------------------------------------------------------------------------
{
  const brain = makeBrain(8, 0);
  const w = makeWorld();
  w.pz = 7;
  check(runUntil(brain, w, "chase", 3), "перед укрытием — погоня");
  w.hidden = true;
  check(runUntil(brain, w, "search", 2), "после пропажи — поиск");
  run(brain, w, 0.5);
  w.hidden = false; // вышел из куста и стоит перед ведьмой
  let again = false;
  run(brain, w, 4, (f) => {
    if (f.state === "notice" || f.state === "chase") again = true;
  });
  check(again, "вышел из куста на виду — ведьма снова замечает и гонится");
}

// ---------------------------------------------------------------------------
// 7. Граница секции: стоит и смотрит, пока видит; потом теряет интерес.
// ---------------------------------------------------------------------------
{
  // 7a. Видит игрока за границей: ждёт watchMin..watchMax и возвращается домой.
  const brain = makeBrain(21, 0);
  const w = makeWorld();
  w.pz = 7;
  check(runUntil(brain, w, "chase", 3), "перед границей — погоня");
  w.inTerritory = false; // игрок пересёк границу секции
  step(brain, w);
  check(brain.state === "watch", `за границей погоня превращается в наблюдение (сейчас ${brain.state})`);
  const posAtWatch = { x: w.x, z: w.z };
  let watched = 0;
  let moved = false;
  run(brain, w, 12, (f) => {
    if (f.state === "watch") {
      watched += DT;
      if (f.speed > 0) moved = true;
    }
  });
  check(!moved, "наблюдая, ведьма стоит на месте");
  check(Math.hypot(w.x - posAtWatch.x, w.z - posAtWatch.z) < Math.hypot(w.x, w.z) + 1, "после наблюдения идёт домой, а не к игроку");
  check(watched >= CFG.watchMin - 0.1, `наблюдала лишь ${watched.toFixed(1)} с (минимум ${CFG.watchMin}) — интерес пропал мгновенно`);
  check(watched <= CFG.watchMax + 0.3, `наблюдала ${watched.toFixed(1)} с (максимум ${CFG.watchMax}) — должна терять интерес`);
  check(["return", "idle", "wander"].includes(brain.state), `после наблюдения ведьма успокаивается (сейчас ${brain.state})`);
  check(Math.hypot(w.x, w.z) <= CFG.wanderRadius + 0.6, "и возвращается к дому");

  // Смотрит на игрока: курс направлен на него.
  const b2 = makeBrain(22, 0);
  const w2 = makeWorld();
  w2.pz = 7;
  w2.px = 3;
  runUntil(b2, w2, "chase", 3);
  w2.inTerritory = false;
  run(b2, w2, 1.5);
  const want = Math.atan2(w2.px - w2.x, w2.pz - w2.z);
  const diff = Math.abs(((b2.yaw - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  check(b2.state === "watch" && diff < 0.2, `при наблюдении ведьма смотрит на игрока (Δ=${diff.toFixed(2)} рад)`);

  // 7b. Потеряла из виду (спрятался за границей) — интерес гаснет быстрее.
  const b3 = makeBrain(23, 0);
  const w3 = makeWorld();
  w3.pz = 7;
  runUntil(b3, w3, "chase", 3);
  w3.inTerritory = false;
  w3.hidden = true;
  let blind = 0;
  run(b3, w3, 12, (f) => {
    if (f.state === "watch") blind += DT;
  });
  check(blind <= CFG.watchMax / 2.5 + 0.4, `без обзора наблюдала ${blind.toFixed(1)} с — должно быть заметно короче`);

  // 7c. Вернулся в секцию и подошёл близко — провокация, ведьма снова гонится.
  const b4 = makeBrain(24, 0);
  const w4 = makeWorld();
  w4.pz = 7;
  runUntil(b4, w4, "chase", 3);
  w4.inTerritory = false;
  run(b4, w4, 1);
  check(b4.state === "watch", "перед провокацией — наблюдение");
  w4.inTerritory = true;
  w4.pz = w4.z + 3.5; // ближе provokeDistance, строго перед ней
  w4.px = w4.x;
  let provoked = false;
  run(b4, w4, 1.5, (f) => {
    if (f.state === "notice" || f.state === "chase") provoked = true;
  });
  check(provoked, "игрок вернулся в секцию и подошёл — ведьма снова бросается");

  // 7d. Чужая секция не сводит с ума спокойную ведьму: стоит/гуляет как обычно.
  const b5 = makeBrain(25, 0);
  const w5 = makeWorld();
  w5.pz = 5;
  w5.inTerritory = false;
  let calm = true;
  run(b5, w5, 20, (f) => {
    if (f.state !== "idle" && f.state !== "wander") calm = false;
  });
  check(calm, "спокойная ведьма не обращает внимания на игрока в соседней секции");
}

// ---------------------------------------------------------------------------
// 8. Разнообразие: характер, погони и поиски не повторяют друг друга.
// ---------------------------------------------------------------------------
{
  const N = 60;
  // 8a. Характеры разные.
  const brains = Array.from({ length: N }, (_, i) => makeBrain(100 + i, 0, "random"));
  check(stdev(brains.map((b) => b.traits.chaseSpeedMul)) > 0.07, "скорость погони у ведьм разная");
  check(stdev(brains.map((b) => b.traits.reactionMul)) > 0.1, "скорость реакции у ведьм разная");
  check(stdev(brains.map((b) => b.traits.fovMul)) > 0.05 && stdev(brains.map((b) => b.traits.viewRangeMul)) > 0.05, "зоркость у ведьм разная");

  // 8b. Одна и та же погоня у разных ведьм идёт по-разному.
  const reactions: number[] = [];
  const arrivals: number[] = [];
  const laterals: number[] = [];
  let hesitations = 0;
  let nobodyHesitated = 0;
  for (let i = 0; i < N; i++) {
    const brain = makeBrain(200 + i, 0, "random");
    const w = makeWorld();
    w.pz = 9;
    let t = 0;
    let tNotice = -1;
    let tChase = -1;
    let tArrive = -1;
    let maxLat = 0;
    let mine = 0;
    let stillFrames = 0;
    run(brain, w, 14, (f) => {
      t += DT;
      if (f.state === "notice" && tNotice < 0) tNotice = t;
      if (f.state === "chase" && tChase < 0) tChase = t;
      const d = Math.hypot(w.px - w.x, w.pz - w.z);
      if (tArrive < 0 && d <= CFG.chaseStopDistance + 0.15) tArrive = t;
      maxLat = Math.max(maxLat, Math.abs(w.x));
      // Остановка посреди погони = стоит в chase не меньше 0.1 с (первый кадр chase тоже с нулевой скоростью — не в счёт).
      const still = f.state === "chase" && f.speed === 0 && d > 3;
      if (still) stillFrames++;
      else {
        if (stillFrames >= 6) mine++;
        stillFrames = 0;
      }
      if (f.speed > MAX_CHASE_SPEED + 1e-9) check(false, `скорость ${f.speed.toFixed(2)} выше предела ${MAX_CHASE_SPEED.toFixed(2)}`);
    });
    if (tNotice >= 0 && tChase >= 0) reactions.push(tChase - tNotice);
    if (tArrive >= 0) arrivals.push(tArrive);
    laterals.push(maxLat);
    hesitations += mine;
    if (mine === 0) nobodyHesitated++;
  }
  const buckets = new Set(reactions.map((r) => Math.round(r / 0.05)));
  check(reactions.length === N, "все ведьмы замечали игрока");
  check(buckets.size >= 10, `пауза узнавания почти не отличается между ведьмами (${buckets.size} разных значений)`);
  check(arrivals.length === N, `не все ведьмы дошли до игрока (${arrivals.length}/${N})`);
  check(stdev(arrivals) >= 0.35, `время подхода почти одинаковое (σ=${stdev(arrivals).toFixed(2)} с)`);
  check(Math.max(...laterals) >= 0.4, `траектории слишком прямые (макс. отклонение ${Math.max(...laterals).toFixed(2)} м)`);
  check(Math.min(...laterals) <= 0.3, `все траектории виляют одинаково сильно (мин. отклонение ${Math.min(...laterals).toFixed(2)} м)`);
  check(hesitations >= 3, `посреди погони почти никто не останавливается (${hesitations})`);
  check(nobodyHesitated >= 3, "некоторые ведьмы идут без остановок");
}
{
  const N = 60;
  // 8c. Поиск после того, как игрок скрылся в кусте: одни сначала оглядываются, другие идут сразу.
  let scanned = 0;
  let hiddenAnchorsOk = true;
  for (let i = 0; i < N; i++) {
    const brain = makeBrain(300 + i, 0, "random");
    const w = makeWorld();
    w.pz = 8;
    if (!runUntil(brain, w, "chase", 3)) continue;
    w.hidden = true;
    const bush = { x: w.px, z: w.pz };
    if (!runUntil(brain, w, "search", 2)) continue;
    const anchor = brain.searchPoint;
    if (!anchor || Math.hypot(anchor.x - bush.x, anchor.z - bush.z) > 0.5) hiddenAnchorsOk = false;
    // Сколько стоит на месте в начале поиска (оглядывается)?
    let stillTime = 0;
    for (let k = 0; k < 120; k++) {
      const f = step(brain, w);
      if (f.state !== "search" || f.speed > 0.05) break;
      stillTime += DT;
    }
    if (stillTime >= CFG.scanMin - 0.05) scanned++;
  }
  check(hiddenAnchorsOk, "если игрок спрятался в кусте, ведьма ищет именно у места пропажи (не «угадывает» вперёд, в сам куст)");
  check(scanned >= N * 0.2 && scanned <= N * 0.8, `оглядывается перед поиском ${scanned}/${N} — должно быть «иногда»`);

  // 8d. Игрок скрылся за препятствием на бегу: одни ведьмы идут к месту пропажи, другие угадывают направление.
  let predicted = 0;
  let sampled = 0;
  for (let i = 0; i < N; i++) {
    const brain = makeBrain(400 + i, 0, "random");
    const w = makeWorld();
    w.pz = 6;
    if (!runUntil(brain, w, "chase", 3)) continue;
    // Игрок бежит прямо от ведьмы (+Z) полсекунды, потом его закрывает препятствие.
    run(brain, w, 0.5, () => {
      w.pz += PLAYER_SPEED * DT;
    });
    const lastSeenZ = w.pz;
    w.losClear = false;
    let reached = false;
    for (let k = 0; k < 120 && !reached; k++) {
      w.pz += PLAYER_SPEED * DT; // игрок продолжает бежать, пока ведьма выжидает «мерцание» обзора
      step(brain, w);
      if (brain.state === "search") reached = true;
    }
    if (!reached) continue;
    sampled++;
    const anchor = brain.searchPoint;
    if (anchor && anchor.z - lastSeenZ > 1.5) predicted++;
  }
  check(sampled >= N * 0.8, `мало прогонов поиска (${sampled}/${N})`);
  check(predicted >= 5 && predicted <= sampled - 5, `«угадывание» направления бегства: ${predicted}/${sampled} — должно быть «иногда»`);
}

// ---------------------------------------------------------------------------
// 9. disengage (после боя): идёт домой и несколько секунд не замечает игрока.
// ---------------------------------------------------------------------------
{
  const brain = makeBrain(9, 0);
  const w = makeWorld();
  w.pz = 4;
  check(runUntil(brain, w, "chase", 3), "перед disengage — погоня");
  brain.disengage(6);
  let seenWhileIgnored = false;
  run(brain, w, 5.5, (f) => {
    if (f.state === "chase" || f.state === "notice") seenWhileIgnored = true;
  });
  check(!seenWhileIgnored, "в течение окна игнора не должна снова замечать/гнаться");

  // Окно игнора короткое: после него ведьма снова замечает игрока в конусе.
  const brain2 = makeBrain(9, 0);
  const w2 = makeWorld();
  w2.pz = 4;
  brain2.disengage(2);
  let noticedInWindow = false;
  run(brain2, w2, 1.9, (f) => {
    if (f.state === "chase" || f.state === "notice") noticedInWindow = true;
  });
  check(!noticedInWindow, "внутри окна игнора (2 с) погони нет");
  run(brain2, w2, 0.3); // окно истекло
  brain2.yaw = Math.atan2(w2.px - w2.x, w2.pz - w2.z); // игрок строго в конусе
  const after = step(brain2, w2);
  check(after.state === "notice", `после окна игнора игрока в конусе снова замечает (сейчас ${after.state})`);
}

// ---------------------------------------------------------------------------
// 10. Дружелюбной стала посреди погони → бросает и идёт домой.
// ---------------------------------------------------------------------------
{
  const brain = makeBrain(10, 0);
  const w = makeWorld();
  w.pz = 6;
  check(runUntil(brain, w, "chase", 3), "погоня до победы игрока");
  w.canDetect = false; // дуэль выиграна → friendly
  run(brain, w, 1);
  check(brain.state === "return" || brain.state === "idle", `после friendly погоня прекращается (сейчас ${brain.state})`);
}

// ---------------------------------------------------------------------------
// 11. Поводок: тащить ведьму через весь мир нельзя — она останавливается и смотрит.
// ---------------------------------------------------------------------------
{
  const brain = makeBrain(11, 0);
  const w = makeWorld();
  w.pz = 6;
  let maxFromHome = 0;
  let sawWatch = false;
  run(brain, w, 90, (f) => {
    // игрок идёт ровно настолько быстро, чтобы оставаться в поле зрения, но не дать себя догнать
    w.pz = Math.max(w.pz, w.z + 7);
    maxFromHome = Math.max(maxFromHome, Math.hypot(w.x, w.z));
    if (f.state === "watch") sawWatch = true;
  });
  check(maxFromHome <= CFG.leash + 2.5, `ведьма ушла от дома на ${maxFromHome.toFixed(1)} м (поводок ${CFG.leash})`);
  check(sawWatch, "дойдя до поводка/устав, ведьма останавливается и смотрит, а не пропадает мгновенно");
}

// ---------------------------------------------------------------------------
// 12. Застревание: уткнулась в стену — не бьётся вечно.
// ---------------------------------------------------------------------------
{
  const brain = makeBrain(12, 0);
  const w = makeWorld();
  w.pz = 8;
  w.blocked = true; // не может сдвинуться
  let sawSearch = false;
  let chaseRun = 0;
  let maxChaseRun = 0;
  run(brain, w, 30, (f) => {
    if (f.state === "search") sawSearch = true;
    chaseRun = f.state === "chase" ? chaseRun + DT : 0;
    maxChaseRun = Math.max(maxChaseRun, chaseRun);
  });
  check(sawSearch, "уткнувшись в препятствие во время погони, ведьма переходит к поиску");
  check(maxChaseRun <= CFG.stuckTime + 0.6, `застрявшая ведьма билась в препятствие ${maxChaseRun.toFixed(1)} с подряд`);
}

// ---------------------------------------------------------------------------
// 14. «Видит игрока прямо сейчас» (hasSpottedPlayer) — от этого зависит, кто бьёт первым при встрече.
// ---------------------------------------------------------------------------
{
  const brain = makeBrain(8, 0);
  const w = makeWorld();
  w.px = 500; // игрок далеко
  w.pz = 500;
  run(brain, w, 2);
  check(!brain.hasSpottedPlayer, "спокойная ведьма игрока не видит");

  w.px = 0;
  w.pz = 6; // перед ней, в конусе
  check(runUntil(brain, w, "notice", 1) && brain.hasSpottedPlayer, "заметила — видит (бьёт первой)");
  check(runUntil(brain, w, "chase", 3) && brain.hasSpottedPlayer, "идёт к игроку — видит");

  w.hidden = true; // спрятался в куст: ведьма его теряет
  check(runUntil(brain, w, "search", 4), "потеряла игрока из виду");
  check(!brain.hasSpottedPlayer, "ищет — уже не видит (подкравшемуся игроку достаётся первый удар)");
}

console.log(`Проверок: ${checks}, провалов: ${failures}`);
if (failures > 0) {
  console.error(`FAILED: ${failures}`);
  process.exit(1);
}
console.log("OK: ИИ ведьмы — зрение, узнавание, погоня, укрытия, граница секции, разнообразие, поводок, застревание");
