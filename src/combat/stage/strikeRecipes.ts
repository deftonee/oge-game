import { Color3, MeshBuilder, Quaternion, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { Mesh, Scene } from "@babylonjs/core";
import { clamp01, easeOutCubic, lerp } from "../../core/easing";

/**
 * Рецепты анимаций ударов — по одному на «образ» школы: камень (механика), горячий пар (термодинамика),
 * луч (оптика), молния (электричество), сфера (квантовые явления и запасной вариант).
 *
 * Лёгкость для слабых устройств: никаких систем частиц и текстур; меши — низкополигональные, создаются
 * лениво при первом использовании и в простое выключены (не рисуются); один материал на эффект;
 * покадровая работа — без выделения памяти (векторы-заготовки переиспользуются).
 */

export type StrikeKind = "stone" | "steam" | "beam" | "lightning" | "orb";

/** Откуда и куда летит заклинание (концы уже учитывают попал/отражён/мимо). */
export interface FlightPath {
  from: Vector3;
  to: Vector3;
}

export interface StrikeEffect {
  /** Сколько секунд длится полёт. */
  readonly flightSeconds: number;
  /** Доля полёта (0…1), на которой заклинание «попадает»: тут применяется урон и вспыхивает удар. */
  readonly impactAt: number;
  /** Включить эффект на старте полёта. */
  begin(path: FlightPath, color: Color3): void;
  /** Кадр полёта: progress 0…1. */
  update(progress: number, dt: number): void;
  /** Выключить эффект (конец полёта или отмена). */
  end(): void;
  dispose(): void;
}

export type EffectFactory = (scene: Scene) => StrikeEffect;

// ---------- Общие мелочи ----------

function unlitMaterial(scene: Scene, name: string): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.disableLighting = true; // свечение без расчёта света — дешёвый фрагментный шейдер
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  return mat;
}

function prepare(mesh: Mesh, material: StandardMaterial): Mesh {
  mesh.material = material;
  mesh.isPickable = false;
  mesh.checkCollisions = false;
  mesh.setEnabled(false);
  return mesh;
}

/** Единичный горизонтальный перпендикуляр к линии from→to (если линия вертикальна — любой). */
function horizontalPerpendicular(from: Vector3, to: Vector3, out: Vector3): Vector3 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-5) return out.copyFromFloats(1, 0, 0);
  return out.copyFromFloats(dz / len, 0, -dx / len);
}

function disposeAll(meshes: readonly Mesh[], material: StandardMaterial): void {
  for (const m of meshes) m.dispose(false, false);
  material.dispose();
}

// ---------- Камень (механика) ----------

function createStone(scene: Scene): StrikeEffect {
  const mat = new StandardMaterial("fx_stoneMat", scene);
  mat.specularColor = Color3.Black();
  const rock = prepare(MeshBuilder.CreateIcoSphere("fx_stone", { radius: 0.2, subdivisions: 1, flat: true }, scene), mat);
  const from = new Vector3();
  const to = new Vector3();
  const ARC_HEIGHT = 0.7;
  let spin = 0;

  return {
    flightSeconds: 0.7,
    impactAt: 1,
    begin(path, color) {
      from.copyFrom(path.from);
      to.copyFrom(path.to);
      mat.diffuseColor = Color3.Lerp(Color3.FromHexString("#7d7468"), color, 0.35);
      rock.position.copyFrom(from);
      rock.rotation.set(0, 0, 0);
      spin = 0;
      rock.setEnabled(true);
    },
    update(p, dt) {
      rock.position.x = lerp(from.x, to.x, p);
      rock.position.z = lerp(from.z, to.z, p);
      rock.position.y = lerp(from.y, to.y, p) + ARC_HEIGHT * 4 * p * (1 - p); // бросок по дуге
      spin += dt * 14;
      rock.rotation.x = spin;
      rock.rotation.z = spin * 0.6;
    },
    end() {
      rock.setEnabled(false);
    },
    dispose() {
      disposeAll([rock], mat);
    },
  };
}

// ---------- Горячий пар (термодинамика) ----------

function createSteam(scene: Scene): StrikeEffect {
  const PUFFS = 6;
  const STAGGER = 0.05; // клубы стартуют один за другим
  const span = 1 - (PUFFS - 1) * STAGGER;
  const mat = unlitMaterial(scene, "fx_steamMat");
  const puffs: Mesh[] = [];
  for (let i = 0; i < PUFFS; i++) {
    puffs.push(prepare(MeshBuilder.CreateSphere(`fx_steam${i}`, { diameter: 0.4, segments: 4 }, scene), mat));
  }
  const from = new Vector3();
  const to = new Vector3();
  const perp = new Vector3();

  return {
    flightSeconds: 0.75,
    impactAt: 1,
    begin(path, color) {
      from.copyFrom(path.from);
      to.copyFrom(path.to);
      horizontalPerpendicular(from, to, perp);
      mat.emissiveColor = Color3.Lerp(Color3.White(), color, 0.3);
      for (const puff of puffs) {
        puff.visibility = 0;
        puff.position.copyFrom(from);
        puff.setEnabled(true);
      }
    },
    update(p) {
      for (let i = 0; i < PUFFS; i++) {
        const puff = puffs[i];
        const local = clamp01((p - i * STAGGER) / span);
        if (local <= 0) {
          puff.visibility = 0;
          continue;
        }
        const sway = Math.sin(local * 6 + i) * 0.12 * local; // клубы чуть расходятся и «плывут»
        puff.position.x = lerp(from.x, to.x, local) + perp.x * sway;
        puff.position.z = lerp(from.z, to.z, local) + perp.z * sway;
        puff.position.y = lerp(from.y, to.y, local) + 0.25 * Math.sin(local * Math.PI) + 0.15 * local; // пар поднимается
        puff.scaling.setAll(lerp(0.5, 1.7, local)); // и разрастается
        puff.visibility = 0.7 * (1 - local * local * local);
      }
    },
    end() {
      for (const puff of puffs) puff.setEnabled(false);
    },
    dispose() {
      disposeAll(puffs, mat);
    },
  };
}

// ---------- Луч (оптика) ----------

function createBeam(scene: Scene): StrikeEffect {
  const mat = unlitMaterial(scene, "fx_beamMat");
  const coreMat = unlitMaterial(scene, "fx_beamCoreMat");
  coreMat.emissiveColor = Color3.White();
  const glow = prepare(MeshBuilder.CreateCylinder("fx_beamGlow", { diameter: 0.28, height: 1, tessellation: 8 }, scene), mat);
  const core = prepare(MeshBuilder.CreateCylinder("fx_beamCore", { diameter: 0.09, height: 1, tessellation: 6 }, scene), coreMat);
  glow.rotationQuaternion = new Quaternion();
  core.rotationQuaternion = new Quaternion();
  const from = new Vector3();
  const dir = new Vector3();
  let totalLen = 1;
  const GROW = 0.35; // доля полёта, за которую луч дотягивается до цели
  const FADE_FROM = 0.6;

  return {
    flightSeconds: 0.55,
    impactAt: GROW,
    begin(path, color) {
      from.copyFrom(path.from);
      path.to.subtractToRef(path.from, dir);
      totalLen = Math.max(0.01, dir.length());
      dir.scaleInPlace(1 / totalLen);
      mat.emissiveColor = color;
      Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir, glow.rotationQuaternion!);
      core.rotationQuaternion!.copyFrom(glow.rotationQuaternion!);
      glow.setEnabled(true);
      core.setEnabled(true);
    },
    update(p) {
      const len = Math.max(0.01, totalLen * easeOutCubic(clamp01(p / GROW)));
      const fade = p < FADE_FROM ? 1 : 1 - (p - FADE_FROM) / (1 - FADE_FROM);
      const half = len / 2;
      for (const m of [glow, core]) {
        m.position.copyFromFloats(from.x + dir.x * half, from.y + dir.y * half, from.z + dir.z * half);
        m.scaling.y = len;
      }
      const pulse = (0.7 + 0.3 * fade) * (1 + 0.15 * Math.sin(p * 40)); // лёгкое мерцание
      glow.scaling.x = glow.scaling.z = pulse;
      core.scaling.x = core.scaling.z = 0.6 + 0.4 * fade;
      glow.visibility = 0.45 * fade;
      core.visibility = fade;
    },
    end() {
      glow.setEnabled(false);
      core.setEnabled(false);
    },
    dispose() {
      glow.dispose(false, false);
      core.dispose(false, false);
      mat.dispose();
      coreMat.dispose();
    },
  };
}

// ---------- Молния (электродинамика) ----------

function createLightning(scene: Scene): StrikeEffect {
  const SEGMENTS = 7;
  const FLICKER = 0.05; // как часто ломаная «перебрасывается»
  const AMPLITUDE = 0.35;
  const mat = unlitMaterial(scene, "fx_boltMat");
  const bolts: Mesh[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    const seg = prepare(MeshBuilder.CreateBox(`fx_bolt${i}`, { width: 0.08, height: 0.08, depth: 1 }, scene), mat);
    seg.rotationQuaternion = new Quaternion();
    bolts.push(seg);
  }
  const from = new Vector3();
  const to = new Vector3();
  const perp = new Vector3();
  // Случайные боковые смещения узлов ломаной (перебрасываются по таймеру).
  const offsetSide = new Float32Array(SEGMENTS + 1);
  const offsetUp = new Float32Array(SEGMENTS + 1);
  const points = Array.from({ length: SEGMENTS + 1 }, () => new Vector3());
  const dir = new Vector3();
  let timer = 0;

  const reroll = (): void => {
    for (let i = 1; i < SEGMENTS; i++) {
      const envelope = Math.sin((Math.PI * i) / SEGMENTS); // концы ломаной стоят на месте
      offsetSide[i] = (Math.random() * 2 - 1) * AMPLITUDE * envelope;
      offsetUp[i] = (Math.random() * 2 - 1) * AMPLITUDE * envelope;
    }
  };

  return {
    flightSeconds: 0.45,
    impactAt: 0.15,
    begin(path, color) {
      from.copyFrom(path.from);
      to.copyFrom(path.to);
      horizontalPerpendicular(from, to, perp);
      mat.emissiveColor = Color3.Lerp(Color3.White(), color, 0.5);
      timer = 0;
      reroll();
      for (const seg of bolts) seg.setEnabled(true);
    },
    update(p, dt) {
      timer -= dt;
      if (timer <= 0) {
        timer = FLICKER;
        reroll();
      }
      const reach = easeOutCubic(clamp01(p / 0.15)); // молния «выстреливает» почти мгновенно
      const fade = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
      for (let i = 0; i <= SEGMENTS; i++) {
        const k = (i / SEGMENTS) * reach;
        points[i].copyFromFloats(
          lerp(from.x, to.x, k) + perp.x * offsetSide[i] * reach,
          lerp(from.y, to.y, k) + offsetUp[i] * reach,
          lerp(from.z, to.z, k) + perp.z * offsetSide[i] * reach
        );
      }
      for (let i = 0; i < SEGMENTS; i++) {
        const a = points[i];
        const b = points[i + 1];
        const seg = bolts[i];
        b.subtractToRef(a, dir);
        const len = dir.length();
        if (len < 1e-4) {
          seg.visibility = 0;
          continue;
        }
        dir.scaleInPlace(1 / len);
        Quaternion.FromUnitVectorsToRef(Vector3.Forward(), dir, seg.rotationQuaternion!);
        seg.position.copyFromFloats((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        seg.scaling.z = len;
        seg.visibility = fade;
      }
    },
    end() {
      for (const seg of bolts) seg.setEnabled(false);
    },
    dispose() {
      disposeAll(bolts, mat);
    },
  };
}

// ---------- Сфера (квантовые явления и запасной вариант) ----------

function createOrb(scene: Scene): StrikeEffect {
  const SATELLITES = 3;
  const mat = unlitMaterial(scene, "fx_orbMat");
  const core = prepare(MeshBuilder.CreateSphere("fx_orbCore", { diameter: 0.38, segments: 6 }, scene), mat);
  const sats: Mesh[] = [];
  for (let i = 0; i < SATELLITES; i++) {
    sats.push(prepare(MeshBuilder.CreateSphere(`fx_orbSat${i}`, { diameter: 0.14, segments: 4 }, scene), mat));
  }
  const from = new Vector3();
  const to = new Vector3();
  const perp = new Vector3();

  return {
    flightSeconds: 0.65,
    impactAt: 1,
    begin(path, color) {
      from.copyFrom(path.from);
      to.copyFrom(path.to);
      horizontalPerpendicular(from, to, perp);
      mat.emissiveColor = color;
      core.setEnabled(true);
      for (const s of sats) s.setEnabled(true);
    },
    update(p) {
      const e = lerp(p, p * p, 0.5); // чуть разгоняется к цели
      const wobble = 0.12 * Math.sin(p * 14);
      core.position.x = lerp(from.x, to.x, e);
      core.position.y = lerp(from.y, to.y, e) + wobble;
      core.position.z = lerp(from.z, to.z, e);
      const orbit = 0.35 * (1 - 0.3 * p);
      for (let i = 0; i < SATELLITES; i++) {
        const a = p * 18 + (i * Math.PI * 2) / SATELLITES; // спутники закручиваются вокруг ядра
        const s = sats[i];
        s.position.x = core.position.x + perp.x * Math.cos(a) * orbit;
        s.position.y = core.position.y + Math.sin(a) * orbit;
        s.position.z = core.position.z + perp.z * Math.cos(a) * orbit;
      }
    },
    end() {
      core.setEnabled(false);
      for (const s of sats) s.setEnabled(false);
    },
    dispose() {
      disposeAll([core, ...sats], mat);
    },
  };
}

/** Фабрики всех видов анимации: добавить вид = дописать строку (тип StrikeKind заставит это сделать). */
export const EFFECT_FACTORIES: Readonly<Record<StrikeKind, EffectFactory>> = {
  stone: createStone,
  steam: createSteam,
  beam: createBeam,
  lightning: createLightning,
  orb: createOrb,
};
