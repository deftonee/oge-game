import { Mesh, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { BackMount } from "../core/PlayerController";
import { shadeHex } from "../core/color";
import { easeOutBack, easeOutCubic } from "../core/easing";
import { getBookById } from "../data/books";
import { getSchoolById } from "../data/spells";
import { buildColoredBoxes, rgb, scaleRgb, type BoxPart, type Rgb } from "../render/coloredMesh";

/**
 * Рюкзак на спине персонажа: каркас из кожаных ремней с латунными пряжками —
 * сквозь «окна» между ремнями видны книги, которые игрок нашёл. Книги стоят
 * каскадом (каждая следующая сдвинута вниз, вбок и ближе к камере), так что ни
 * одна не закрывает другую целиком, а у каждой виден свой цвет школы.
 *
 * Бюджет: каркас — один меш (≈ 22 бокса, один draw call), каждая книга — один
 * меш (≈ 11 боксов); всё на общем вершинно-цветовом материале. Книг не больше,
 * чем школ (сейчас 5), поэтому в сцене рюкзак стоит ≤ 6 draw call.
 *
 * Система координат — как у BackMount: начало на середине задней грани торса,
 * −z уходит назад от персонажа (к камере), +y вверх, +x — вправо при взгляде со спины.
 */

/** Размеры книги в рюкзаке (м): чуть крупнее реальной — чтобы читалась издали. */
export const BOOK = { width: 0.3, height: 0.42, thickness: 0.085 } as const;

/** Полезный объём рюкзака (внутри ремней). */
export interface PackSpace {
  width: number;
  height: number;
  /** Глубина от спины назад; ремни лежат снаружи, у −depth. */
  depth: number;
  /** Высота центра относительно середины торса. */
  centerY: number;
}

export function packSpaceFor(torso: BackMount["torso"]): PackSpace {
  return { width: torso.width * 0.88, height: torso.height * 0.92, depth: 0.3, centerY: -torso.height * 0.02 };
}

/** Положение книги в рюкзаке. */
export interface BookSlot {
  x: number;
  y: number;
  z: number;
  /** Наклон вокруг оси взгляда (рад): веер из книг, как карты в руке. */
  rotZ: number;
}

/**
 * Раскладка каскадом: индекс 0 — самая старая книга (выше, левее и ближе к
 * спине), каждая следующая — правее, ниже и ближе к камере. Шаги сжимаются,
 * когда книг много, чтобы все помещались в рюкзак.
 */
export function bookCascadeSlot(index: number, count: number, space: PackSpace): BookSlot {
  const steps = Math.max(1, count - 1);
  const dx = Math.min(0.075, (space.width - BOOK.width - 0.04) / steps);
  const dy = Math.min(0.05, (space.height - BOOK.height - 0.08) / steps);
  const dz = Math.min(0.05, (space.depth - BOOK.thickness - 0.03) / steps);
  const off = index - (count - 1) / 2;
  return {
    x: off * dx,
    y: space.centerY - off * dy,
    z: -(BOOK.thickness / 2 + 0.012 + index * dz),
    rotZ: -off * 0.05,
  };
}

// ---------------------------------------------------------------------------
// Геометрия
// ---------------------------------------------------------------------------

const LEATHER: Rgb = rgb("#7a4724");
const LEATHER_LIGHT: Rgb = rgb("#946038");
const LEATHER_DARK: Rgb = rgb("#47270f");
const BRASS: Rgb = rgb("#d9ae4e");
const PAGES: Rgb = rgb("#efe2bd");

const STRAP_WIDTH = 0.055;
const STRAP_THICKNESS = 0.025;

/** Высоты поперечных ремней относительно центра рюкзака. */
const BELT_OFFSETS = [-0.27, 0, 0.27] as const;

function packFrameParts(space: PackSpace, torso: BackMount["torso"]): BoxPart[] {
  const { width: W, height: H, depth: D, centerY: cy } = space;
  const t = STRAP_THICKNESS;
  const sw = STRAP_WIDTH;
  const outer = D + 2 * t; // от спины до внешней грани поперечных ремней
  const parts: BoxPart[] = [];

  // Дно: кожаный лоток, на нём стоят книги.
  parts.push({ size: [W, 0.07, D + t], pos: [0, cy - H / 2 + 0.035, -(D + t) / 2], color: LEATHER_DARK });

  // Продольные ремни на задней стенке — между ними «окна», где видны книги.
  for (const side of [-1, 1]) {
    parts.push({ size: [sw, H, t], pos: [side * 0.2, cy, -(D + t / 2)], color: LEATHER });
  }

  // Поперечные ремни (опоясывают рюкзак и уходят к спине по бокам).
  for (const dy of BELT_OFFSETS) {
    const y = cy + dy;
    parts.push({ size: [W, sw, t], pos: [0, y, -(D + t + t / 2)], color: LEATHER_LIGHT });
    for (const side of [-1, 1]) {
      parts.push({ size: [t, sw, outer], pos: [side * (W / 2 - t / 2), y, -outer / 2], color: LEATHER_LIGHT });
    }
  }

  // Пряжка на среднем ремне: латунная рамка с тёмным просветом.
  parts.push({ size: [0.085, 0.085, 0.03], pos: [0, cy, -(outer + 0.015)], color: BRASS });
  parts.push({ size: [0.05, 0.05, 0.034], pos: [0, cy, -(outer + 0.017)], color: LEATHER_DARK });

  // Лямки: по задней стенке торса, через плечо (мимо головы) и вниз по груди.
  const strapX = torso.width / 2 - 0.06;
  const torsoTop = torso.height / 2;
  const packTop = cy + H / 2;
  const backLen = torsoTop - (packTop - 0.1);
  for (const side of [-1, 1]) {
    parts.push({ size: [0.07, backLen, 0.02], pos: [side * strapX, torsoTop - backLen / 2, -0.011], color: LEATHER_DARK });
    parts.push({ size: [0.07, 0.02, torso.depth + 0.04], pos: [side * strapX, torsoTop + 0.011, torso.depth / 2], color: LEATHER_DARK });
    parts.push({ size: [0.07, 0.46, 0.02], pos: [side * strapX, torsoTop - 0.23, torso.depth + 0.011], color: LEATHER_DARK });
    parts.push({ size: [0.05, 0.05, 0.026], pos: [side * strapX, -0.02, torso.depth + 0.013], color: BRASS });
  }
  return parts;
}

function bookParts(cover: Rgb): BoxPart[] {
  const { width: w, height: h, thickness: t } = BOOK;
  const dark = scaleRgb(cover, 0.76);
  const frameZ = -(t / 2 + 0.002);
  const frame = (size: [number, number, number], x: number, y: number): BoxPart => ({ size, pos: [x, y, frameZ], color: BRASS });
  return [
    // Задняя обложка (она смотрит на камеру), передняя и корешок.
    { size: [w, h, 0.014], pos: [0, 0, -(t / 2 - 0.007)], color: cover },
    { size: [w, h, 0.014], pos: [0, 0, t / 2 - 0.007], color: dark },
    { size: [0.016, h, t], pos: [-(w / 2 - 0.008), 0, 0], color: dark },
    // Блок страниц чуть утоплен — по краям виден срез бумаги.
    { size: [w - 0.03, h - 0.024, t - 0.02], pos: [0.008, 0, 0], color: PAGES },
    // Золотая рамка и эмблема на обложке.
    frame([w - 0.07, 0.008, 0.008], 0.008, h / 2 - 0.04),
    frame([w - 0.07, 0.008, 0.008], 0.008, -(h / 2 - 0.04)),
    frame([0.008, h - 0.08, 0.008], -(w / 2 - 0.045), 0),
    frame([0.008, h - 0.08, 0.008], w / 2 - 0.035, 0),
    { size: [0.1, 0.1, 0.008], pos: [0.008, 0.01, frameZ], color: BRASS },
    { size: [0.064, 0.064, 0.011], pos: [0.008, 0.01, frameZ - 0.001], color: dark },
  ];
}

/** Цвет обложки книги: цвет её школы, потемнённый до «кожи». */
export function bookCoverColor(bookId: string): Rgb {
  const book = getBookById(bookId);
  const school = book ? getSchoolById(book.schoolId) : undefined;
  return rgb(shadeHex(school?.color ?? "#8a6a3a", 0.66));
}

// ---------------------------------------------------------------------------
// Рюкзак
// ---------------------------------------------------------------------------

/** Сколько длится появление новой книги (падает сверху в открытый рюкзак). */
const ENTER_SECONDS = 0.5;
const ENTER_DROP = 0.42;
/** Скорость скольжения старых книг на новые места (1/с, экспоненциальное сглаживание). */
const SLIDE_RATE = 14;
const SETTLE_EPS = 1e-4;

interface BookEntry {
  id: string;
  mesh: Mesh;
  cur: BookSlot;
  target: BookSlot;
  /** 0 — только появилась, 1 — легла на место. */
  enter: number;
}

export class Backpack {
  private readonly root: TransformNode;
  private readonly frame: Mesh;
  private readonly space: PackSpace;
  private readonly books: BookEntry[] = [];
  private animating = false;
  private readonly scene: Scene;

  constructor(scene: Scene, mount: BackMount) {
    this.scene = scene;
    this.space = packSpaceFor(mount.torso);
    this.root = new TransformNode("backpack", scene);
    this.root.parent = mount.node;
    this.frame = buildColoredBoxes("backpack_frame", packFrameParts(this.space, mount.torso), scene);
    this.frame.parent = this.root;
  }

  public get bookCount(): number {
    return this.books.length;
  }

  public hasBook(id: string): boolean {
    return this.books.some((b) => b.id === id);
  }

  /** Идут ли анимации (рюкзак тогда нужно обновлять каждый кадр). */
  public get isAnimating(): boolean {
    return this.animating;
  }

  /**
   * Приводит содержимое к списку id: недостающие книги добавляются, лишние
   * убираются. Для старта игры и восстановления прогресса — без анимации
   * (animate = false), для «нашёл прямо сейчас» — с ней.
   */
  public syncBooks(ids: readonly string[], animate = false): void {
    for (const entry of [...this.books]) {
      if (!ids.includes(entry.id)) this.removeBook(entry);
    }
    for (const id of ids) this.addBook(id, animate);
  }

  /** Кладёт книгу в рюкзак. false — если такая уже лежит или id неизвестен. */
  public addBook(id: string, animate = true): boolean {
    if (this.hasBook(id) || !getBookById(id)) return false;
    const mesh = buildColoredBoxes(`backpack_book_${id}`, bookParts(bookCoverColor(id)), this.scene);
    mesh.parent = this.root;
    const slot = bookCascadeSlot(this.books.length, this.books.length + 1, this.space);
    this.books.push({ id, mesh, cur: { ...slot }, target: slot, enter: animate ? 0 : 1 });
    this.relayout(animate);
    if (animate) this.animating = true;
    return true;
  }

  /** Мировая позиция центра рюкзака — куда «улетают» найденные предметы. */
  public worldCenter(out: Vector3 = new Vector3()): Vector3 {
    this.root.computeWorldMatrix(true);
    return Vector3.TransformCoordinatesFromFloatsToRef(0, this.space.centerY, -this.space.depth / 2, this.root.getWorldMatrix(), out);
  }

  /** Раз в кадр: старые книги плавно занимают новые места, новая — падает на своё. */
  public update(dt: number): void {
    if (!this.animating) return;
    const k = 1 - Math.exp(-SLIDE_RATE * Math.min(dt, 0.1));
    let busy = false;
    for (const e of this.books) {
      const dx = e.target.x - e.cur.x;
      const dy = e.target.y - e.cur.y;
      const dz = e.target.z - e.cur.z;
      const dr = e.target.rotZ - e.cur.rotZ;
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) + Math.abs(dr) < SETTLE_EPS) {
        e.cur = { ...e.target };
      } else {
        e.cur = { x: e.cur.x + dx * k, y: e.cur.y + dy * k, z: e.cur.z + dz * k, rotZ: e.cur.rotZ + dr * k };
        busy = true;
      }
      if (e.enter < 1) {
        e.enter = Math.min(1, e.enter + dt / ENTER_SECONDS);
        busy = busy || e.enter < 1;
      }
      this.place(e);
    }
    this.animating = busy;
  }

  public dispose(): void {
    this.root.dispose(); // вместе с каркасом и книгами; узел крепления принадлежит игроку
    this.books.length = 0;
  }

  // -------------------------------------------------------------------------

  private removeBook(entry: BookEntry): void {
    entry.mesh.dispose();
    this.books.splice(this.books.indexOf(entry), 1);
    this.relayout(false);
  }

  /** Пересчитывает целевые места: каскад всегда центрирован, поэтому при добавлении старые книги чуть сдвигаются. */
  private relayout(animate: boolean): void {
    this.books.forEach((e, i) => {
      e.target = bookCascadeSlot(i, this.books.length, this.space);
      if (!animate) e.cur = { ...e.target };
      this.place(e);
    });
  }

  private place(e: BookEntry): void {
    const drop = (1 - easeOutCubic(e.enter)) * ENTER_DROP;
    const scale = 0.55 + 0.45 * easeOutBack(e.enter);
    e.mesh.position.set(e.cur.x, e.cur.y + drop, e.cur.z);
    e.mesh.rotation.z = e.cur.rotZ;
    e.mesh.scaling.setAll(scale);
  }
}
