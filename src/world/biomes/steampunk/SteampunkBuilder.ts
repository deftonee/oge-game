import { Mesh, MeshBuilder, type InstancedMesh, type Scene } from "@babylonjs/core";
import { BUSH_ENVELOPE_RADIUS } from "../../../render/foliage";
import { eyeLevelRadius, type TreeVolume } from "../../../stealth/cover";
import type { BushVolume } from "../../../stealth/bushes";
import { yawAt } from "../../geometry/SectionGeometry";
import type { SectionSpec } from "../../spec/SectionSpec";
import { BOILER, MACHINE, PLAQUE, PIPES, PORTHOLE, PROP, TANK, TOWER, WALL_GAP, WALL_GEAR, layoutSteampunk } from "./layout";
import { steampunkKit } from "./models";
import { PLAQUE_ART_COUNT, plaquePlanes } from "./textures";

/**
 * Материализация стимпанк-цеха в сцене для одной секции (биом "steampunk", тема
 * «термодинамика»). Игровая механика остаётся прежней, меняется только вид:
 *   кусты-укрытия (spec.bushes)   → паровые решётки в полу с клубами пара (в пару можно спрятаться);
 *   рощи деревьев (spec.trees)    → вертикальные котлы и паровые башни (перекрывают обзор ведьм,
 *                                   становятся прозрачными между камерой и игроком; у каждого —
 *                                   свой коллайдер treeCol_*, как у деревьев в поле);
 *   бордюр (borderLeft/Right)     → оборудование вдоль стен: паровые машины, баки, латунные
 *                                   таблички с формулами, иллюминаторы, трубы, шестерни;
 *   трава                         → нет (стальной пол);
 *   + напольный реквизит: ящики, бочки, малые машины, тележки с углём.
 *
 * Предметы — instances шаблонов (models.ts), без создания геометрии в момент сборки.
 * Столкновения реквизита, машин и баков — ОДИН слитый невидимый меш на секцию (как у
 * стен); котлы и башни получают собственные коллайдеры (контракт «дерева», см. ниже).
 * Расстановку считает чистая layoutSteampunk(spec) — здесь только перевод в мировые координаты.
 */

/** Всё, что строителю нужно от SectionChunk. Списки объёмов заполняются на месте. */
export interface SteampunkHost {
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
/** Высота невидимого коллайдера машины (маховик и труба выше, но игроку достаточно не пройти сквозь корпус). */
const MACHINE_BLOCK_HEIGHT = 1.2;
/** Габариты и обзор укрытий: радиус сечения на высоте глаз ведьмы и радиус сферы «между камерой и игроком». */
const COVER = {
  boiler: { w: 1.4, d: 1.4, h: BOILER.h, block: 0.75, fade: 1.15 },
  tower: { w: TOWER.len, d: TOWER.depth, h: TOWER.h, block: 0.9, fade: 1.3 },
} as const;
/** Насколько гравировка лежит перед поверхностью таблички (между тёмной вставкой и латунной рамкой). */
const PLAQUE_OFFSET = PLAQUE.thickness / 2 + 0.025;

export function buildSteampunk(host: SteampunkHost): void {
  const { scene, spec } = host;
  const kit = steampunkKit(scene);
  const layout = layoutSteampunk(spec);
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
    const box = MeshBuilder.CreateBox(`steampunkCol_${tag}_${colliders.length}`, { width: length, height, depth }, scene);
    box.position.set(w.x, height / 2, w.z);
    box.rotation.y = yawAt(spec, lz) + yaw;
    colliders.push(box);
  };

  // --- Напольный реквизит: ящики, бочки, малые машины, тележки. ---
  layout.props.forEach((p, i) => {
    spawn(kit.props[p.variant], `prop_${tag}_${i}`, p.x, p.z, p.yawJitter);
    solid(p.x, p.z, p.yawJitter, PROP.w - 0.1, PROP.h, PROP.d - 0.1);
  });

  // --- Оборудование у стен: лицом в цех. ---
  const planes = plaquePlanes(scene);
  layout.wall.forEach((item, i) => {
    const sign = item.side === "right" ? 1 : -1;
    // Лицо модели (+Z) должно смотреть в цех: у правой стены это −X секции, у левой — +X.
    const yaw = item.side === "right" ? -HALF_PI : HALF_PI;
    const at = (depth: number): number => sign * (half - WALL_GAP - depth / 2);
    const name = `${item.kind}_${tag}_${item.side[0]}${i}`;

    if (item.kind === "machine") {
      spawn(kit.machines[item.variant], name, at(MACHINE.depth), item.z, yaw);
      solid(at(MACHINE.depth), item.z, yaw, MACHINE.len, MACHINE_BLOCK_HEIGHT, MACHINE.depth);
      if (item.decor === "porthole") spawn(kit.porthole, `${name}_porthole`, at(PORTHOLE.thickness), item.z, yaw);
      else if (item.decor === "pipes") spawn(kit.pipes, `${name}_pipes`, at(PIPES.thickness), item.z, yaw);
      else if (item.decor === "gear") spawn(kit.wallGear, `${name}_gear`, at(WALL_GEAR.thickness), item.z, yaw);
    } else if (item.kind === "plaque") {
      const px = at(PLAQUE.thickness);
      spawn(kit.plaque, name, px, item.z, yaw);
      const plane = planes[item.variant % PLAQUE_ART_COUNT];
      if (plane) {
        // Гравировка — плоскость перед поверхностью таблички; плоскость видна с −Z, поэтому разворачиваем на π.
        const w = host.toWorld(px, item.z);
        const facing = yawAt(spec, item.z) + yaw;
        const engraving = plane.createInstance(`${name}_text`);
        engraving.position.set(w.x + Math.sin(facing) * PLAQUE_OFFSET, PLAQUE.y, w.z + Math.cos(facing) * PLAQUE_OFFSET);
        engraving.rotation.y = facing + Math.PI;
        engraving.isPickable = false;
        own(engraving);
      }
    } else {
      spawn(kit.tank, name, at(TANK.depth), item.z, yaw);
      solid(at(TANK.depth), item.z, yaw, TANK.len, TANK.h, TANK.depth);
    }
  });

  // --- Котлы и паровые башни на месте «деревьев»: твёрдые, перекрывают обзор, прозрачнеют перед камерой. ---
  for (const c of layout.cover) {
    const w = host.toWorld(c.x, c.z);
    const turn = c.quarterTurns * HALF_PI;
    const dims = COVER[c.kind];
    // Клон, а не instance: у instance нет собственной прозрачности (см. SectionChunk.buildBushes).
    const mesh = (c.kind === "boiler" ? kit.boiler : kit.tower).clone(`${c.kind}_${tag}_${c.treeIndex}`);
    mesh.setEnabled(true);
    mesh.isVisible = true;
    mesh.isPickable = false;
    mesh.position.set(w.x, 0, w.z);
    mesh.rotation.y = yawAt(spec, c.z) + turn;
    own(mesh);
    // Контракт «дерева-укрытия» (как в поле): у каждого свой невидимый коллайдер treeCol_* в его позиции.
    const col = MeshBuilder.CreateBox(`treeCol_${tag}_${c.treeIndex}`, { width: dims.w, height: dims.h, depth: dims.d }, scene);
    col.position.set(w.x, dims.h / 2, w.z);
    col.rotation.y = yawAt(spec, c.z) + turn;
    col.isVisible = false;
    col.isPickable = false;
    col.checkCollisions = true;
    own(col);
    host.treeVolumes.push({
      x: w.x,
      z: w.z,
      blockRadius: dims.block,
      canopyY: dims.h / 2,
      canopyRadius: dims.fade,
      canopy: mesh,
      alpha: 1,
    });
  }

  // --- Паровые решётки на месте кустов: в клубах пара по-прежнему можно спрятаться (без коллизии). ---
  spec.bushes.forEach((s, i) => {
    const w = host.toWorld(s.x, s.z);
    const radius = BUSH_ENVELOPE_RADIUS * s.scale;

    const vent = kit.vent.createInstance(`vent_${tag}_${i}`);
    vent.position.set(w.x, 0, w.z);
    vent.scaling.setAll(s.scale);
    vent.isPickable = false;
    own(vent);

    // Облако садится на решётку: центр габарита на высоте радиуса, как у куста в поле.
    // Имя bush_* — по контракту кустов-укрытий (стелс и тесты ищут их по нему).
    const mesh = kit.steam.clone(`bush_${tag}_${i}`);
    mesh.setEnabled(true);
    mesh.isVisible = true;
    mesh.isPickable = false;
    mesh.position.set(w.x, radius, w.z);
    mesh.scaling.setAll(s.scale);
    mesh.rotation.y = spec.yaw + s.rot;
    own(mesh);
    host.bushVolumes.push({
      kind: "bush",
      x: w.x,
      z: w.z,
      radius,
      blockRadius: eyeLevelRadius(radius, radius),
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
    merged.name = `steampunkCol_${tag}`;
    merged.isVisible = false;
    merged.isPickable = false;
    merged.checkCollisions = true;
    own(merged);
  }
}
