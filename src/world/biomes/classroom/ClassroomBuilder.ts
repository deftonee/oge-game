import { Mesh, MeshBuilder, type InstancedMesh, type Scene } from "@babylonjs/core";
import { BUSH_ENVELOPE_RADIUS, createBush, variantKeyAt } from "../../../render/foliage";
import { eyeLevelRadius, type TreeVolume } from "../../../stealth/cover";
import type { BushVolume } from "../../../stealth/bushes";
import { yawAt } from "../../geometry/SectionGeometry";
import type { SectionSpec } from "../../spec/SectionSpec";
import { BENCH, BOARD, CABINET, DESK, POSTER, SHELF, WALL_GAP, WINDOW, layoutClassroom } from "./layout";
import { POT_HEIGHT, classroomKit } from "./models";
import { BOARD_ART_COUNT, chalkPlanes } from "./textures";

/**
 * Материализация школьного класса в сцене для одной секции (биом "classroom").
 *
 * Что во что превращается — игровая механика остаётся прежней, меняется только вид:
 *   кусты-укрытия (spec.bushes)   → большие комнатные растения в горшках (можно спрятаться);
 *   рощи деревьев (spec.trees)    → приборные шкафы и стеллажи (перекрывают обзор ведьм,
 *                                   становятся прозрачными между камерой и игроком; у каждого —
 *                                   свой коллайдер treeCol_*, как у деревьев в поле);
 *   бордюр (borderLeft/Right)     → мебель вдоль стен: лабораторные столы с электрическими
 *                                   установками, доски, окна, плакаты, стеллажи;
 *   трава                         → нет (чистый пол);
 *   + парты со стульями (колонки и ряды по всей секции).
 *
 * Мебель — instances шаблонов (models.ts), без создания геометрии в момент сборки.
 * Столкновения парт, столов и стеллажей — ОДИН слитый невидимый меш на секцию (как у стен);
 * шкафы-укрытия получают собственные коллайдеры (контракт «дерева», см. ниже).
 * Расстановку считает чистая layoutClassroom(spec) — здесь только перевод в мировые координаты.
 */

/** Всё, что строителю нужно от SectionChunk. Списки объёмов заполняются на месте. */
export interface ClassroomHost {
  scene: Scene;
  spec: SectionSpec;
  /** Локальные координаты секции → мировые. */
  toWorld(localX: number, localZ: number): { x: number; z: number };
  /** Сюда складывается всё, что надо освободить при разборке секции. */
  disposables: { dispose(): void }[];
  bushVolumes: BushVolume[];
  treeVolumes: TreeVolume[];
}

const HALF_PI = Math.PI / 2;
/** Радиус сечения шкафа на высоте глаз для обзора ведьм (прямоугольник 1.7×0.6 → ближайший круг). */
const CABINET_BLOCK_RADIUS = 0.85;
/** Радиус сферы шкафа для проверки «между камерой и игроком». */
const CABINET_FADE_RADIUS = 1.15;
/** Насколько мел лежит перед поверхностью доски. */
const CHALK_OFFSET = BOARD.thickness / 2 + 0.056;

export function buildClassroom(host: ClassroomHost): void {
  const { scene, spec } = host;
  const kit = classroomKit(scene);
  const layout = layoutClassroom(spec);
  const half = spec.width / 2;
  const tag = `${spec.index}${spec.forkBranch ?? ""}`;
  const colliders: Mesh[] = [];

  const own = <T extends { dispose(): void }>(item: T): T => {
    host.disposables.push(item);
    return item;
  };

  /** Instance шаблона в точке секции; yaw — поворот относительно курса секции в этой точке. */
  const spawn = (template: Mesh, name: string, lx: number, lz: number, yaw: number): InstancedMesh => {
    const w = host.toWorld(lx, lz);
    const inst = template.createInstance(name);
    inst.position.set(w.x, 0, w.z);
    inst.rotation.y = yawAt(spec, lz) + yaw;
    inst.isPickable = false;
    return own(inst);
  };

  /** Невидимый коробочный коллайдер (сливаются в один меш в конце). Длина — вдоль x предмета. */
  const solid = (lx: number, lz: number, yaw: number, length: number, height: number, depth: number): void => {
    const w = host.toWorld(lx, lz);
    const box = MeshBuilder.CreateBox(`classroomCol_${tag}_${colliders.length}`, { width: length, height, depth }, scene);
    box.position.set(w.x, height / 2, w.z);
    box.rotation.y = yawAt(spec, lz) + yaw;
    colliders.push(box);
  };

  // --- Парты: колонки и ряды, лицом по ходу секции. ---
  layout.desks.forEach((d, i) => {
    spawn(kit.desks[d.variant], `desk_${tag}_${i}`, d.x, d.z, d.yawJitter);
    solid(d.x, d.z, d.yawJitter, DESK.w, DESK.h, DESK.d);
  });

  // --- Мебель у стен: лицом в комнату. ---
  const planes = chalkPlanes(scene);
  layout.wall.forEach((item, i) => {
    const sign = item.side === "right" ? 1 : -1;
    // Лицо модели (+Z) должно смотреть в комнату: у правой стены это −X секции, у левой — +X.
    const yaw = item.side === "right" ? -HALF_PI : HALF_PI;
    const at = (depth: number): number => sign * (half - WALL_GAP - depth / 2);
    const name = `${item.kind}_${tag}_${item.side[0]}${i}`;

    if (item.kind === "bench") {
      spawn(kit.benches[item.variant], name, at(BENCH.depth), item.z, yaw);
      solid(at(BENCH.depth), item.z, yaw, BENCH.len, BENCH.h, BENCH.depth);
      if (item.decor === "window") spawn(kit.window, `${name}_window`, at(WINDOW.thickness), item.z, yaw);
      else if (item.decor === "poster") spawn(kit.posters[item.decorVariant], `${name}_poster`, at(POSTER.thickness), item.z, yaw);
    } else if (item.kind === "board") {
      const bx = at(BOARD.thickness);
      spawn(kit.board, name, bx, item.z, yaw);
      const plane = planes[item.variant % BOARD_ART_COUNT];
      if (plane) {
        // Мел — плоскость перед поверхностью доски; плоскость видна с −Z, поэтому разворачиваем на π.
        const w = host.toWorld(bx, item.z);
        const facing = yawAt(spec, item.z) + yaw;
        const chalk = plane.createInstance(`${name}_chalk`);
        chalk.position.set(w.x + Math.sin(facing) * CHALK_OFFSET, BOARD.y, w.z + Math.cos(facing) * CHALK_OFFSET);
        chalk.rotation.y = facing + Math.PI;
        chalk.isPickable = false;
        own(chalk);
      }
    } else {
      spawn(kit.shelf, name, at(SHELF.depth), item.z, yaw);
      solid(at(SHELF.depth), item.z, yaw, SHELF.len, SHELF.h, SHELF.depth);
    }
  });

  // --- Шкафы и стеллажи на месте «деревьев»: твёрдые, перекрывают обзор, прозрачнеют перед камерой. ---
  for (const c of layout.cabinets) {
    const w = host.toWorld(c.x, c.z);
    const turn = c.quarterTurns * HALF_PI;
    // Клон, а не instance: у instance нет собственной прозрачности (см. SectionChunk.buildBushes).
    const mesh = (c.kind === "cabinet" ? kit.cabinet : kit.rack).clone(`cabinet_${tag}_${c.treeIndex}`);
    mesh.setEnabled(true);
    mesh.isVisible = true;
    mesh.isPickable = false;
    mesh.position.set(w.x, 0, w.z);
    mesh.rotation.y = yawAt(spec, c.z) + turn;
    own(mesh);
    // Контракт «дерева-укрытия» (как в поле): у каждого свой невидимый коллайдер treeCol_* в его позиции.
    const col = MeshBuilder.CreateBox(`treeCol_${tag}_${c.treeIndex}`, { width: CABINET.len, height: CABINET.h, depth: CABINET.depth }, scene);
    col.position.set(w.x, CABINET.h / 2, w.z);
    col.rotation.y = yawAt(spec, c.z) + turn;
    col.isVisible = false;
    col.isPickable = false;
    col.checkCollisions = true;
    own(col);
    host.treeVolumes.push({
      x: w.x,
      z: w.z,
      blockRadius: CABINET_BLOCK_RADIUS,
      canopyY: CABINET.h / 2,
      canopyRadius: CABINET_FADE_RADIUS,
      canopy: mesh,
      alpha: 1,
    });
  }

  // --- Комнатные растения на месте кустов: в них по-прежнему можно спрятаться (без коллизии). ---
  spec.bushes.forEach((s, i) => {
    const w = host.toWorld(s.x, s.z);
    const radius = BUSH_ENVELOPE_RADIUS * s.scale;
    const lift = POT_HEIGHT * s.scale;

    const pot = kit.pot.createInstance(`pot_${tag}_${i}`);
    pot.position.set(w.x, 0, w.z);
    pot.scaling.setAll(s.scale);
    pot.isPickable = false;
    own(pot);

    // Листва садится на горшок: центр габарита выше на высоту горшка (почти вся — часть листвы заходит за край).
    const centerY = radius + lift * 0.8;
    // Имя bush_* — по контракту кустов-укрытий (стелс и тесты ищут их по нему).
    const mesh = createBush(scene, `bush_${tag}_${i}`, variantKeyAt(w.x, w.z));
    mesh.position.set(w.x, centerY, w.z);
    mesh.scaling.setAll(s.scale);
    mesh.rotation.y = spec.yaw + s.rot;
    own(mesh);
    host.bushVolumes.push({
      kind: "bush",
      x: w.x,
      z: w.z,
      radius,
      blockRadius: eyeLevelRadius(radius, centerY),
      mesh,
      alpha: 1,
      setAlpha: (a) => {
        mesh.visibility = a;
      },
    });
  });

  // --- Один слитый коллайдер на все твёрдые предметы секции. ---
  const merged = colliders.length > 1 ? Mesh.MergeMeshes(colliders, true, true) : colliders[0];
  if (merged) {
    merged.name = `classroomCol_${tag}`;
    merged.isVisible = false;
    merged.isPickable = false;
    merged.checkCollisions = true;
    own(merged);
  }
}
