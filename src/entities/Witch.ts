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
 *
 * После победы ведьма не исчезает (по фидбэку), а становится "дружелюбной":
 * снимает шляпу, светлеет и больше не атакует сама — но с ней можно снова
 * спарринговать по запросу (клавиша E), см. main.ts.
 */
export class Witch {
  public readonly root: TransformNode;
  public readonly spell: Spell;
  public readonly id: string;
  public friendly: boolean;

  private readonly robeMat: StandardMaterial;
  private readonly hat: Mesh;
  private readonly friendlyMarker: Mesh;

  constructor(scene: Scene, position: Vector3, spell: Spell, id: string, initialFriendly = false) {
    this.id = id;
    this.spell = spell;
    this.friendly = initialFriendly;

    const built = this.buildModel(scene, spell.color);
    this.root = built.root;
    this.robeMat = built.robeMat;
    this.hat = built.hat;
    this.friendlyMarker = built.friendlyMarker;
    this.root.position = position;

    if (initialFriendly) this.applyFriendlyVisual();
  }

  private buildModel(
    scene: Scene,
    colorHex: string
  ): { root: TransformNode; robeMat: StandardMaterial; hat: Mesh; friendlyMarker: Mesh } {
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

    // Маленький зелёный огонёк над головой — виден только когда ведьма
    // дружелюбна, сигнализирует издалека "с этой можно спарринговать".
    const markerMat = new StandardMaterial("friendlyMarkerMat", scene);
    markerMat.diffuseColor = Color3.FromHexString("#7be08a");
    markerMat.emissiveColor = Color3.FromHexString("#4fd66a");
    const friendlyMarker = MeshBuilder.CreateSphere("friendlyMarker", { diameter: 0.18 }, scene);
    friendlyMarker.material = markerMat;
    friendlyMarker.position.y = 2.5;
    friendlyMarker.parent = root;
    friendlyMarker.setEnabled(false);

    return { root, robeMat, hat, friendlyMarker };
  }

  /** Победа больше не убирает ведьму из мира — она остаётся, но перестаёт нападать. */
  public setFriendly(value: boolean): void {
    this.friendly = value;
    if (value) this.applyFriendlyVisual();
    else this.applyHostileVisual();
  }

  private applyFriendlyVisual(): void {
    this.hat.setEnabled(false);
    this.friendlyMarker.setEnabled(true);
    this.robeMat.diffuseColor = Color3.Lerp(this.robeMat.diffuseColor, Color3.White(), 0.55);
  }

  private applyHostileVisual(): void {
    this.hat.setEnabled(true);
    this.friendlyMarker.setEnabled(false);
    this.robeMat.diffuseColor = Color3.FromHexString(this.spell.color);
  }

  public get position(): Vector3 {
    return this.root.position;
  }

  public dispose(): void {
    this.root.dispose();
  }
}
