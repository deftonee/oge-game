import {
  Scene,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  TransformNode,
  Mesh,
} from "@babylonjs/core";
import { Spell } from "../data/spells";

/**
 * Враг-ведьма. У ведьмы одна "тема атаки" (spell) — заклинаниями этой темы
 * она бьёт игрока, и ими же вынужден защищаться игрок. При этом сама тема
 * на ведьму не действует ("она ей и так владеет") — атаковать её нужно
 * любым ДРУГИМ изученным заклинанием. Подробности дуэли — в CombatManager.
 */
export class Witch {
  public readonly root: TransformNode;
  public readonly spell: Spell;
  public readonly id: string;

  constructor(scene: Scene, position: Vector3, spell: Spell, id: string) {
    this.id = id;
    this.spell = spell;
    this.root = this.buildModel(scene, spell.color);
    this.root.position = position;
  }

  private buildModel(scene: Scene, colorHex: string): TransformNode {
    const root = new TransformNode("witch", scene);

    const robeMat = new StandardMaterial("robeMat", scene);
    robeMat.diffuseColor = Color3.FromHexString(colorHex);

    const hatMat = new StandardMaterial("hatMat", scene);
    hatMat.diffuseColor = Color3.FromHexString("#1a1f33");

    const robe = MeshBuilder.CreateCylinder("robe", { diameterTop: 0.5, diameterBottom: 0.9, height: 1.4 }, scene);
    robe.material = robeMat;
    robe.position.y = 0.9;
    robe.parent = root;

    const head = MeshBuilder.CreateSphere("witchHead", { diameter: 0.45 }, scene);
    head.material = robeMat;
    head.position.y = 1.75;
    head.parent = root;

    const hat = MeshBuilder.CreateCylinder("witchHat", { diameterTop: 0, diameterBottom: 0.4, height: 0.6 }, scene);
    hat.material = hatMat;
    hat.position.y = 2.25;
    hat.parent = root;

    return root;
  }

  public get position(): Vector3 {
    return this.root.position;
  }

  public dispose(): void {
    this.root.dispose();
  }
}
