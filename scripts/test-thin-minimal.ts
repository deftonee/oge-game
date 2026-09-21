// Минимальный тест thinInstanceAdd на NullEngine в esbuild-бандле:
// работает ли thinInstanceCount вообще в этом окружении?
import { NullEngine, Scene, MeshBuilder, Vector3, Matrix, Quaternion } from "@babylonjs/core";

const engine = new NullEngine();
const scene = new Scene(engine);
const base = MeshBuilder.CreateSphere("b", { diameter: 2.4 }, scene);
for (let i = 0; i < 3; i++) {
  base.thinInstanceAdd(Matrix.Compose(new Vector3(1, 1, 1), Quaternion.Identity(), new Vector3(i * 5, 1.2, i * 5)), false);
}
base.thinInstanceRefreshBoundingInfo(true);
console.log("thinInstanceCount:", base.thinInstanceCount);
console.log("hasWorldMatrices:", !!base.thinInstanceWorldMatrices, base.thinInstanceWorldMatrices?.length);
const bi = base.getBoundingInfo().boundingBox;
console.log("bbox y:", bi.minimumWorld.y.toFixed(2), "..", bi.maximumWorld.y.toFixed(2));
scene.render();
console.log("after render count:", base.thinInstanceCount);
