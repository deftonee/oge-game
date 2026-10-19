import type { Scene } from "@babylonjs/core";

/**
 * Ленивый «один на сцену» объект (общий материал, набор шаблонов геометрии).
 * Кэш слабый: вместе со сценой освобождается и всё, что на неё завязано.
 */
export function perScene<T>(make: (scene: Scene) => T): (scene: Scene) => T {
  const cache = new WeakMap<Scene, T>();
  return (scene) => {
    let value = cache.get(scene);
    if (value === undefined) {
      value = make(scene);
      cache.set(scene, value);
    }
    return value;
  };
}
