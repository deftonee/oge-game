import { Scene, Mesh, MeshBuilder, StandardMaterial, Color3, Vector3, Quaternion } from "@babylonjs/core";
import type { WorldSpec } from "./spec/WorldSpec";
import { localToWorld } from "./geometry/SectionGeometry";

/**
 * Туман между последней отрисованной секцией мира и башней (доработка):
 * на конце каждой секции стоит полупрозрачная стена тумана. Активна ровно
 * одна — на frontier (самой дальней построенной секции, см. WorldStreamer):
 * за ней уже ничего не построено, там туман скрывает остаток пути до башни.
 * При продвижении игрока стена плавно тает и появляется следующая, дальше
 * по трассе — туман «отступает» без скачков.
 */
export class FogManager {
  private static readonly FOG_COLOR = "#0d1120";
  private static readonly FOG_ALPHA = 0.85;
  private static readonly FOG_HEIGHT = 18; // выше башни (12 + крыша 3)
  private static readonly PLANE_GAP = 2.6; // две плоскости для ощущения объёма
  private static readonly FADE_SPEED = 2.5; // 1/с

  private readonly mat: StandardMaterial;
  /**
   * Стены тумана, сгруппированные по spec.index, а НЕ по позиции в
   * world.sections. Окно стриминга, frontier и видимость веток в
   * WorldStreamer считаются по spec.index; после каждой развилки эти два
   * способа нумерации расходятся (ветки A/B делят один index, схождение J
   * получает index+1, а массив sections при этом растёт на 4 позиции —
   * см. WorldStreamer.sectionAt). Старая индексация `entries[i]` (i — номер
   * секции в массиве) на любом мире с развилкой подставляла стену тумана не
   * на ту секцию — обычно на одну из веток развилки вместо реального
   * frontier, что не покрывалось тестами (test-world-streamer.ts проверяет
   * fog только рядом со спавном, ДО первой развилки).
   * Ключ — spec.index; значение — список стен (длиннее 1, если ветки
   * развилки делят этот index).
   */
  private readonly entriesByIndex = new Map<number, { planes: Mesh[]; visibility: number }[]>();
  private lastFrontier = -2;
  private settled = true;

  constructor(scene: Scene, world: WorldSpec) {
    this.mat = new StandardMaterial("fogMat", scene);
    this.mat.diffuseColor = Color3.FromHexString(FogManager.FOG_COLOR);
    this.mat.emissiveColor = Color3.FromHexString(FogManager.FOG_COLOR);
    this.mat.specularColor = Color3.Black();
    this.mat.alpha = FogManager.FOG_ALPHA;
    this.mat.backFaceCulling = false;
    this.mat.disableLighting = true;

    for (const section of world.sections) {
      const planes: Mesh[] = [];
      // Обычные секции: туман чуть за кромкой пола, в неотрисованной зоне.
      // Подход к башне (tier 0): башня стоит на length+2 — стены тумана
      // ставятся ПЕРЕД ней на самом полу подхода, чтобы скрыть её до финала.
      const baseOffset = section.tier === 0 ? -2.5 : 3;
      for (let p = 0; p < 2; p++) {
        const pos = localToWorld(section, 0, section.length + baseOffset + p * FogManager.PLANE_GAP);
        const plane = MeshBuilder.CreatePlane(
          `fog_${section.index}_${p}`,
          { width: section.width + 8, height: FogManager.FOG_HEIGHT },
          scene
        );
        plane.material = this.mat;
        plane.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), section.yaw);
        plane.position.set(pos.x, FogManager.FOG_HEIGHT / 2, pos.z);
        plane.visibility = 0;
        plane.isVisible = false;
        // Пометка для инспектора/фильтров: «fog» с конкретным sectionIndex
        // и planeIndex (0 — ближняя к секции, 1 — дальняя). Помогает понять,
        // какая именно плоскость внезапно проявилась/скрылась.
        plane.metadata = {
          kind: "fog",
          sectionIndex: section.index,
          planeIndex: p,
          sectionTier: section.tier,
          sectionYaw: section.yaw,
        };
        planes.push(plane);
      }
      const list = this.entriesByIndex.get(section.index) ?? [];
      list.push({ planes, visibility: 0 });
      this.entriesByIndex.set(section.index, list);
    }
  }

  /**
   * Вызывается каждый кадр. frontier — индекс самой дальней построенной
   * секции (WorldStreamer.frontierIndex()); её стена тумана разгорается,
   * остальные плавно гаснут.
   */
  public update(frontierIndex: number, deltaSeconds: number): void {
    if (frontierIndex === this.lastFrontier && this.settled) return;

    if (frontierIndex !== this.lastFrontier) {
      // Логируем только реальные переключения frontier — плавное гашение
      // старой стены и разгорание новой (это и есть «появляются/исчезают
      // плоскости» при движении игрока).
      // eslint-disable-next-line no-console
      console.log(`[fog] frontier ${this.lastFrontier} -> ${frontierIndex}`);
      this.lastFrontier = frontierIndex;
    }

    const k = Math.min(1, deltaSeconds * FogManager.FADE_SPEED);
    let settled = true;
    for (const [index, list] of this.entriesByIndex) {
      const target = index === frontierIndex ? 1 : 0;
      for (const e of list) {
        const prevVisible = e.visibility > 0.01;
        const v = target > e.visibility ? Math.min(target, e.visibility + k) : Math.max(target, e.visibility - k);
        if (Math.abs(v - target) > 0.005) settled = false;
        e.visibility = v;
        const visible = v > 0.01;
        for (const plane of e.planes) {
          plane.visibility = visible ? v : 0;
          if (plane.isVisible !== visible) {
            plane.isVisible = visible;
            // Пишем только момент появления/исчезновения — иначе заспамит
            // каждый кадр (FADE_SPEED=2.5, при резкой смене видимости).
            if (visible) {
              const meta = plane.metadata as { sectionIndex: number; planeIndex: number } | null;
              // eslint-disable-next-line no-console
              console.log(
                `[fog] +plane section=${meta?.sectionIndex ?? "?"}#${meta?.planeIndex ?? "?"} vis=${v.toFixed(2)}`
              );
            } else if (prevVisible) {
              const meta = plane.metadata as { sectionIndex: number; planeIndex: number } | null;
              // eslint-disable-next-line no-console
              console.log(
                `[fog] -plane section=${meta?.sectionIndex ?? "?"}#${meta?.planeIndex ?? "?"} vis=${v.toFixed(2)}`
              );
            }
          }
        }
      }
    }
    this.settled = settled;
  }

  /** Видима ли стена тумана секции (для тестов и отладки). */
  public isWallActive(index: number): boolean {
    const list = this.entriesByIndex.get(index);
    return !!list && list.some((e) => e.visibility > 0.5);
  }

  public dispose(): void {
    for (const list of this.entriesByIndex.values()) {
      for (const e of list) {
        for (const plane of e.planes) plane.dispose();
      }
    }
    this.entriesByIndex.clear();
    this.mat.dispose();
  }
}
