import type { WorldSpec } from "../spec/WorldSpec";

/**
 * Логирование сгенерированного мира: секции + барьеры на их концах, одним
 * collapsed-блоком на прогон. Секции нумеруются общим индексом spec.index,
 * барьеры привязаны к gate.id. Двойные ворота развилки печатаются рядом, чтобы
 * при баге «внезапно появляются/исчезают плоскости» сразу было видно ожидаемое
 * число барьеров и их параметры (x/width/школа/fork).
 */
export function logWorldSpec(world: WorldSpec, seed: number): void {
  if (typeof console === "undefined") return;
  const tag = "[world-gen]";
  // eslint-disable-next-line no-console
  console.groupCollapsed(
    `${tag} seed=${seed} sections=${world.sections.length} spawn=(${world.spawnPoint.x.toFixed(2)},${world.spawnPoint.z.toFixed(2)}) tower=(${world.tower.x.toFixed(2)},${world.tower.z.toFixed(2)})`
  );
  for (const s of world.sections) {
    const gates = s.gates
      .map(
        (g) =>
          `id=${g.id} school=${g.schoolId ?? "-"} req=${g.requiredSpells} x=${g.x.toFixed(2)} w=${g.width.toFixed(2)}${g.fork ? " fork" : ""}`
      )
      .join(" | ");
    // eslint-disable-next-line no-console
    console.log(
      `${tag} #${s.index} tier=${s.tier} "${s.color}" border=${s.borderStyle} yaw=${s.yaw.toFixed(3)} curvature=${s.curvature.toFixed(4)} start=(${s.start.x.toFixed(2)},${s.start.z.toFixed(2)}) end=(${s.end.x.toFixed(2)},${s.end.z.toFixed(2)}) width=${s.width} length=${s.length.toFixed(2)} forkBranch=${s.forkBranch ?? "-"}${s.isDeadEnd ? "(dead)" : ""} partitionDepth=${s.partitionDepth.toFixed(2)} gates=[${gates || "-"}] entities=w${s.witches.length}/b${s.bonfires.length}/p${s.practiceTargets.length}/c${s.chests.length}/spur${s.sideSpurs.length}`
    );
  }
  // eslint-disable-next-line no-console
  console.groupEnd();
}
