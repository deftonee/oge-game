import { Scene, MeshBuilder, StandardMaterial, Color3 } from "@babylonjs/core";

/**
 * Башня-экзамен (п.5 ТЗ). В отличие от секций коридора, строится один раз
 * и не входит в систему потоковой загрузки — остаётся на месте; пока игрок
 * далеко, её скрывает туман (FogManager) на frontier отрисованных секций.
 */
export function buildTower(scene: Scene, x: number, z: number): void {
  const baseMat = new StandardMaterial("towerMat", scene);
  baseMat.diffuseColor = Color3.FromHexString("#3a2f55");

  const roofMat = new StandardMaterial("towerRoofMat", scene);
  roofMat.diffuseColor = Color3.FromHexString("#ffb020");

  const base = MeshBuilder.CreateCylinder("towerBase", { diameter: 4, height: 12 }, scene);
  base.position.set(x, 6, z);
  base.material = baseMat;
  base.checkCollisions = true;

  const roof = MeshBuilder.CreateCylinder("towerRoof", { diameterTop: 0, diameterBottom: 4.6, height: 3 }, scene);
  roof.position.set(x, 13.5, z);
  roof.material = roofMat;
}