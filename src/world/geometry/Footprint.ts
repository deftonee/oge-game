/**
 * Footprint — ЕДИНЫЙ источник истины о том, где в мире есть пол и где нужны стены.
 *
 * Зачем один источник. Если ставить стены «по месту», отдельным кодом на каждый
 * случай (боковые ленты, смена ширины, схождение веток, торцевые крышки,
 * проёмы ниш), то на стыках формулы расходятся: где-то стены не хватает (падение
 * в бездну), где-то она лишняя (глухой проход, из секции не выйти).
 *
 * Здесь принцип не зависит от случаев:
 *
 *   1. Пол мира — объединение простых полигонов (FootprintPiece): полоса-дуга
 *      секции, заплатки шва веток, рукава-ниши, площадка у башни.
 *      Меш пола строится из ТЕХ ЖЕ точек, что и полигон (rails) — стена и
 *      пол совпадают с точностью до float, расхождения «рендер ≠ коллизия» нет.
 *   2. Стена нужна ровно там, где граница полигона НЕ закрыта другим полом.
 *      Это и есть граница объединения: стыки с соседями, проёмы ниш и
 *      раздвоение веток получаются сами, без отдельной логики.
 *   3. Ничего не зависит от того, какие чанки сейчас построены (стриминг):
 *      всё считается по spec всего мира. Каждый кусок стены принадлежит
 *      полигону, чью границу он закрывает, поэтому строится ровно один раз.
 *
 * Стыки обязаны ПЕРЕКРЫВАТЬСЯ, а не просто касаться (рукав ниши заходит в пол
 * родителя, заплатка шва — в пол J): тогда сантиметровые рассогласования
 * дуги и хорды не дают щелей. Касание «ребро в ребро» (конец секции i = начало
 * секции i+1) тоже допустимо — оно совпадает точно, а проба «чуть снаружи»
 * (PROBE_EPS) устойчива к шуму float.
 *
 * Модуль — чистая математика: без Babylon, без rng, без состояния (кроме кэша
 * FootprintIndex). Поэтому его можно тестировать миллионами сидов (см.
 * scripts/test-world-footprint.ts).
 */

import type { SectionSpec } from "../spec/SectionSpec";
import type { Vec2 } from "./SectionGeometry";
import { distPointToSegment, localToWorld, sampleBorderPath, yawAt } from "./SectionGeometry";

/** Длина одного шага дискретизации дуги (м) — компромисс гладкости/полигонажа. */
export const CURVE_SEGMENT_LENGTH = 2.5;
/** Максимальная толщина стены (она растёт ОТ границы пола НАРУЖУ — в бездну). */
export const WALL_THICKNESS = 0.3;
/** Самое тонкое тело стены — только у самой вершины острого клина бездны. */
export const MIN_WALL_THICKNESS = 0.02;
/** Насколько рукав-ниша заходит в пол родителя (м): страховка от щели дуга/хорда. */
export const SPUR_OVERLAP = 0.6;
/** Площадка у башни: полуширина и границы по оси (локально от центра башни). */
export const APRON_HALF_WIDTH = 3;
export const APRON_BEFORE_TOWER = 2.5;
export const APRON_AFTER_TOWER = 2.0;
/** Расстояние от конца подхода до центра башни (см. WorldGenerator.assembleWorld). */
export const TOWER_OFFSET = 2;

/** Проба «чуть снаружи границы» для классификации куска ребра. */
const PROBE_EPS = 1e-3;
/** Куски ребра короче этого — численный шум, стены не требуют. */
const MIN_SEGMENT = 1e-3;
/** Допуск «точка лежит на отрезке» при дроблении рёбер. */
const ON_SEGMENT_TOL = 1e-6;
/**
 * «Укус» стены в пол меньше этого (м) игнорируем: дуга и хорда полилинии
 * расходятся на миллиметры, и без допуска стены у каждой двери ниши
 * зря утончались бы.
 */
const BITE_TOLERANCE = 0.02;

export type FootprintKind = "strip" | "patch" | "spur" | "apron";

export interface FootprintPiece {
  /** Уникальный стабильный id (для логов и тай-брейка дублей). */
  id: string;
  /** Порядковый номер в мире: меньший номер «выигрывает» при дубле границы. */
  order: number;
  kind: FootprintKind;
  /** Индекс секции-владельца (spec.index; ветки A/B делят индекс — смотри id). */
  sectionIndex: number;
  /** Цвет пола: у заплатки — цвет ветки, у остальных — цвет секции. */
  color: string;
  /** Высота пола над нулём — разводит перекрывающиеся полы против z-fighting. */
  y: number;
  /** Две образующие ленты пола (меш = CreateRibbon по этим путям; порядок задаёт лицо вверх). */
  rails: [Vec2[], Vec2[]];
  /** Контур против часовой (в плоскости x,z), замкнутый неявно. */
  outline: Vec2[];
  bbox: { minX: number; minZ: number; maxX: number; maxZ: number };
}

/** Кусок стены: внутренняя грань лежит ровно на границе пола, тело — наружу. */
export interface WallSeg {
  a: Vec2;
  b: Vec2;
  /** Единичная нормаль наружу (в сторону бездны). */
  n: Vec2;
  /** Толщина тела стены наружу (≤ WALL_THICKNESS). */
  t: number;
  /** id полигона, чью границу закрывает кусок. */
  pieceId: string;
}

// ---------------------------------------------------------------------------
// Построение полигонов секции
// ---------------------------------------------------------------------------

function bboxOf(points: Vec2[]): FootprintPiece["bbox"] {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, minZ, maxX, maxZ };
}

function signedArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p.x * q.z - q.x * p.z;
  }
  return s / 2;
}

function makePiece(
  id: string,
  kind: FootprintKind,
  sectionIndex: number,
  color: string,
  y: number,
  railA: Vec2[],
  railB: Vec2[]
): FootprintPiece {
  // Порядок рельс определяет, КУДА смотрит лицевая грань Babylon-ленты, а
  // коллизии игрока учитывают только грани, смотрящие вверх (DOUBLESIDE этого
  // не исправляет). Лицо смотрит вверх, когда контур «рельса A вперёд, рельса B
  // назад» идёт по часовой стрелке в плоскости (x, z). Рельсы заплаток шва
  // приходили в обратном порядке — по такому полу игрок не стоял, а медленно
  // проваливался. Приводим порядок к единому правилу здесь, а не в вызывающих.
  if (signedArea([...railA, ...[...railB].reverse()]) > 0) [railA, railB] = [railB, railA];

  // Контур для стен нормируем на CCW (наружу смотрит правая нормаль ребра).
  let outline = [...railA, ...[...railB].reverse()];
  if (signedArea(outline) < 0) outline = outline.reverse();
  return { id, order: 0, kind, sectionIndex, color, y, rails: [railA, railB], outline, bbox: bboxOf(outline) };
}

/** Полигоны ОДНОЙ секции: полоса, заплатки шва, ниши, площадка у башни. */
export function sectionPieces(spec: SectionSpec): FootprintPiece[] {
  const pieces: FootprintPiece[] = [];
  const tag = `${spec.index}${spec.forkBranch ?? ""}`;
  const half = spec.width / 2;

  // Основная полоса — дуга постоянной кривизны. Точки те же, что у меша пола.
  // У схождения J полоса чуть выше веток, которые под неё заходят.
  pieces.push(
    makePiece(
      `strip_${tag}`,
      "strip",
      spec.index,
      spec.color,
      spec.seam ? 0.01 : 0,
      sampleBorderPath(spec, -half, CURVE_SEGMENT_LENGTH),
      sampleBorderPath(spec, half, CURVE_SEGMENT_LENGTH)
    )
  );

  // Заплатки шва «ветка → J» (данные считает TrackBuilder.computeSeam, в
  // J-локальных координатах; J — прямая, localToWorld даёт точный перевод).
  if (spec.seam) {
    spec.seam.patches.forEach((p, i) => {
      const w = (v: Vec2) => localToWorld(spec, v.x, v.z);
      pieces.push(
        makePiece(`patch_${tag}_${i}`, "patch", spec.index, p.color, 0.02, [w(p.edgeA), w(p.edgeB)], [w(p.lineA), w(p.lineB)])
      );
    });
  }

  // Ниши: прямой рукав в собственной системе координат, дверной торец заходит
  // в пол родителя на SPUR_OVERLAP.
  for (const spur of spec.sideSpurs) {
    const frame = { start: spur.start, yaw: spur.yaw, curvature: 0 };
    const h = spur.width / 2;
    const at = (x: number, z: number) => localToWorld(frame, x, z);
    pieces.push(
      makePiece(
        `spur_${spur.id}`,
        "spur",
        spec.index,
        spec.color,
        0.01,
        [at(-h, -SPUR_OVERLAP), at(-h, spur.length)],
        [at(h, -SPUR_OVERLAP), at(h, spur.length)]
      )
    );
  }

  // Площадка у башни: без неё башня (радиус 2) стоит в 2 м за кромкой, а по
  // краям остаются щели шире коллайдера игрока — туда можно упасть.
  if (spec.tier === 0) {
    const centerLocal = localToWorld(spec, 0, spec.length + TOWER_OFFSET);
    const frame = { start: centerLocal, yaw: yawAt(spec, spec.length), curvature: 0 };
    const at = (x: number, z: number) => localToWorld(frame, x, z);
    pieces.push(
      makePiece(
        `apron_${tag}`,
        "apron",
        spec.index,
        spec.color,
        0.01,
        [at(-APRON_HALF_WIDTH, -APRON_BEFORE_TOWER), at(-APRON_HALF_WIDTH, APRON_AFTER_TOWER)],
        [at(APRON_HALF_WIDTH, -APRON_BEFORE_TOWER), at(APRON_HALF_WIDTH, APRON_AFTER_TOWER)]
      )
    );
  }

  return pieces;
}

// ---------------------------------------------------------------------------
// Планиметрия: точка в полигоне, пересечения, дробление рёбер
// ---------------------------------------------------------------------------

/** Чётно-нечётный тест «точка внутри полигона» (луч вдоль +x). */
export function pointInPolygon(x: number, z: number, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i];
    const pj = poly[j];
    if (pi.z > z !== pj.z > z) {
      const xCross = pj.x + ((z - pj.z) * (pi.x - pj.x)) / (pi.z - pj.z);
      if (x < xCross) inside = !inside;
    }
  }
  return inside;
}

function bboxOverlap(a: FootprintPiece["bbox"], b: FootprintPiece["bbox"], pad: number): boolean {
  return a.minX - pad <= b.maxX && a.maxX + pad >= b.minX && a.minZ - pad <= b.maxZ && a.maxZ + pad >= b.minZ;
}

/**
 * Параметры t∈(0,1), в которых отрезок ab нужно разрезать, чтобы каждый
 * кусок целиком лежал по одну сторону от границ других полигонов: собственные
 * пересечения рёбер плюс «Т-стыки» — вершины чужих рёбер, лежащие на ab.
 */
function splitParams(a: Vec2, b: Vec2, others: FootprintPiece[]): number[] {
  const rx = b.x - a.x;
  const rz = b.z - a.z;
  const len2 = rx * rx + rz * rz;
  const len = Math.sqrt(len2);
  const ts: number[] = [0, 1];
  for (const q of others) {
    const poly = q.outline;
    for (let i = 0; i < poly.length; i++) {
      const c = poly[i];
      const d = poly[(i + 1) % poly.length];

      // 1) Вершина чужого ребра лежит на ab → точка разреза.
      const cx = c.x - a.x;
      const cz = c.z - a.z;
      const tC = (cx * rx + cz * rz) / len2;
      if (tC > 0 && tC < 1 && Math.abs(cx * rz - cz * rx) / len < ON_SEGMENT_TOL) ts.push(tC);

      // 2) Собственное пересечение рёбер.
      const sx = d.x - c.x;
      const sz = d.z - c.z;
      const denom = rx * sz - rz * sx;
      if (Math.abs(denom) < 1e-12) continue; // параллельны: Т-стыки учтены выше
      const t = (cx * sz - cz * sx) / denom;
      const u = (cx * rz - cz * rx) / denom;
      if (t > 0 && t < 1 && u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
    }
  }
  ts.sort((p, q) => p - q);
  // Склеиваем почти совпавшие параметры.
  const out: number[] = [];
  for (const t of ts) {
    if (out.length === 0 || (t - out[out.length - 1]) * len > MIN_SEGMENT * 0.5) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// FootprintIndex — пол всего мира и вывод стен
// ---------------------------------------------------------------------------

export class FootprintIndex {
  private readonly all: FootprintPiece[] = [];
  private readonly bySection = new Map<SectionSpec, FootprintPiece[]>();
  private readonly wallCache = new Map<SectionSpec, WallSeg[]>();

  constructor(sections: readonly SectionSpec[]) {
    let order = 0;
    for (const spec of sections) {
      const pieces = sectionPieces(spec);
      for (const p of pieces) p.order = order++;
      this.bySection.set(spec, pieces);
      this.all.push(...pieces);
    }
  }

  /** Все полигоны пола мира. */
  public get pieces(): readonly FootprintPiece[] {
    return this.all;
  }

  /** Полигоны конкретной секции (пусто, если секция не из этого мира). */
  public piecesOf(spec: SectionSpec): readonly FootprintPiece[] {
    return this.bySection.get(spec) ?? [];
  }

  /** Есть ли пол под точкой (в объединении всех полигонов). */
  public covers(x: number, z: number): boolean {
    for (const p of this.all) {
      const b = p.bbox;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (pointInPolygon(x, z, p.outline)) return true;
    }
    return false;
  }

  /** Стены секции: границы её полигонов, не закрытые полом соседей. Кэшируется. */
  public wallsOf(spec: SectionSpec): readonly WallSeg[] {
    let walls = this.wallCache.get(spec);
    if (!walls) {
      walls = [];
      for (const piece of this.piecesOf(spec)) walls.push(...this.wallsOfPiece(piece));
      this.wallCache.set(spec, walls);
    }
    return walls;
  }

  private neighbours(piece: FootprintPiece, pad: number): FootprintPiece[] {
    return this.all.filter((q) => q !== piece && bboxOverlap(piece.bbox, q.bbox, pad));
  }

  private coveredByAny(x: number, z: number, candidates: FootprintPiece[], self: FootprintPiece): boolean {
    if (pointInPolygon(x, z, self.outline)) return true;
    for (const q of candidates) {
      const b = q.bbox;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (pointInPolygon(x, z, q.outline)) return true;
    }
    return false;
  }

  /**
   * Точка глубже BITE_TOLERANCE внутри какого-либо ОДНОГО полигона. Глубину
   * меряем по каждому полигону отдельно, а не по объединению: в узкой щели
   * между расходящимися ветками объединение «замкнуто» с двух сторон, и
   * по нему любая точка щели выглядела бы глубоко внутри пола.
   */
  private deepCovered(x: number, z: number, candidates: FootprintPiece[], self: FootprintPiece): boolean {
    const inDeep = (q: FootprintPiece): boolean => {
      const b = q.bbox;
      if (x < b.minX - BITE_TOLERANCE || x > b.maxX + BITE_TOLERANCE || z < b.minZ - BITE_TOLERANCE || z > b.maxZ + BITE_TOLERANCE) {
        return false;
      }
      if (!pointInPolygon(x, z, q.outline)) return false;
      const poly = q.outline;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const c = poly[(i + 1) % poly.length];
        if (distPointToSegment(x, z, a.x, a.z, c.x, c.z) < BITE_TOLERANCE) return false;
      }
      return true;
    };
    if (inDeep(self)) return true;
    for (const q of candidates) if (inDeep(q)) return true;
    return false;
  }

  /** Чужое ребро с МЕНЬШИМ order, совпадающее с куском и смотрящее туда же (дубль границы). */
  private duplicatedByEarlier(mid: Vec2, n: Vec2, self: FootprintPiece, candidates: FootprintPiece[]): boolean {
    for (const q of candidates) {
      if (q.order >= self.order) continue;
      const poly = q.outline;
      for (let i = 0; i < poly.length; i++) {
        const c = poly[i];
        const d = poly[(i + 1) % poly.length];
        const ex = d.x - c.x;
        const ez = d.z - c.z;
        const el = Math.hypot(ex, ez);
        if (el < 1e-9) continue;
        const qn = { x: ez / el, z: -ex / el };
        if (qn.x * n.x + qn.z * n.z < 0.999) continue;
        const dist = Math.abs((mid.x - c.x) * qn.x + (mid.z - c.z) * qn.z);
        const along = ((mid.x - c.x) * ex + (mid.z - c.z) * ez) / (el * el);
        if (dist < 1e-4 && along > -1e-6 && along < 1 + 1e-6) return true;
      }
    }
    return false;
  }

  private wallsOfPiece(piece: FootprintPiece): WallSeg[] {
    const candidates = this.neighbours(piece, 0.5);
    const poly = piece.outline;
    const out: WallSeg[] = [];

    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < MIN_SEGMENT) continue;
      // Контур CCW → наружу смотрит правая нормаль ребра.
      const n: Vec2 = { x: dz / len, z: -dx / len };

      const ts = splitParams(a, b, candidates);
      for (let k = 0; k + 1 < ts.length; k++) {
        const t0 = ts[k];
        const t1 = ts[k + 1];
        if ((t1 - t0) * len < MIN_SEGMENT) continue;
        const pa: Vec2 = { x: a.x + dx * t0, z: a.z + dz * t0 };
        const pb: Vec2 = { x: a.x + dx * t1, z: a.z + dz * t1 };
        const mid: Vec2 = { x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 };

        // Проба чуть снаружи: если там пол (свой или соседний) — граница закрыта.
        if (this.coveredByAny(mid.x + n.x * PROBE_EPS, mid.z + n.z * PROBE_EPS, candidates, piece)) continue;
        if (this.duplicatedByEarlier(mid, n, piece, candidates)) continue;

        for (const seg of this.fitThickness(piece, candidates, pa, pb, n, 0)) {
          // Клин между расходящимися ветками у вершины уже миллиметра: после
          // дробления середина куска может оказаться в чужом полу — такой кусок
          // ничего не закрывает (в щель не упасть), стена в нём была бы «лишней».
          const mx = (seg.a.x + seg.b.x) / 2 + n.x * PROBE_EPS;
          const mz = (seg.a.z + seg.b.z) / 2 + n.z * PROBE_EPS;
          if (!this.coveredByAny(mx, mz, candidates, piece)) out.push(seg);
        }
      }
    }
    return out;
  }

  /**
   * Тело стены растёт наружу от границы, но у острых «клиньев» бездны (между
   * расходящимися ветками) толстое тело заходит в соседний пол. Поэтому
   * толщину подбираем по месту: сначала пробуем WALL_THICKNESS, потом режем
   * кусок пополам, и только у самой вершины клина утончаем.
   */
  private fitThickness(
    piece: FootprintPiece,
    candidates: FootprintPiece[],
    a: Vec2,
    b: Vec2,
    n: Vec2,
    depth: number
  ): WallSeg[] {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const make = (t: number): WallSeg => ({ a, b, n, t, pieceId: piece.id });
    if (this.bodyIsClear(piece, candidates, a, b, n, WALL_THICKNESS)) return [make(WALL_THICKNESS)];

    if (depth < 2 && len > 0.5) {
      const m: Vec2 = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      return [...this.fitThickness(piece, candidates, a, m, n, depth + 1), ...this.fitThickness(piece, candidates, m, b, n, depth + 1)];
    }
    for (const t of [WALL_THICKNESS / 2, WALL_THICKNESS / 4, WALL_THICKNESS / 8]) {
      if (this.bodyIsClear(piece, candidates, a, b, n, t)) return [make(t)];
    }
    return [make(MIN_WALL_THICKNESS)];
  }

  /** Тело стены (прямоугольник a,b,+n·t) не заходит ни в один пол. */
  private bodyIsClear(
    piece: FootprintPiece,
    candidates: FootprintPiece[],
    a: Vec2,
    b: Vec2,
    n: Vec2,
    t: number
  ): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const inset = Math.min(0.002, len / 4);
    const alongSamples = 9;
    for (let i = 0; i < alongSamples; i++) {
      const s = inset + ((len - 2 * inset) * i) / (alongSamples - 1);
      const px = a.x + (dx / len) * s;
      const pz = a.z + (dz / len) * s;
      for (const f of [0.35, 0.7, 1]) {
        const x = px + n.x * t * f;
        const z = pz + n.z * t * f;
        if (this.deepCovered(x, z, candidates, piece)) return false;
      }
    }
    return true;
  }
}
