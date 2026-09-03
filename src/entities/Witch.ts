import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { Spell } from "../data/spells";
import { createWitchFigure, WitchFigure, WitchExpression } from "./witchFigure";

/**
 * Враг-ведьма. У ведьмы одна "тема атаки" (spell) — заклинаниями этой темы
 * она бьёт игрока, и ими же вынужден защищаться игрок. При этом сама тема
 * на ведьму не действует ("она ей и так владеет") — атаковать её нужно
 * любым ДРУГИМ изученным заклинанием. Подробности дуэли — в CombatManager.
 *
 * После победы ведьма не исчезает (по фидбэку), а становится "дружелюбной":
 * снимает шляпу, светлеет и больше не атакует сама — но с ней можно снова
 * спарринговать по запросу (клавиша E), см. main.ts.
 *
 * Модель — процедурная фигурка из witchFigure.ts: idle-покачивание рук,
 * взмах посохом, мимика. Мимика привязана к состоянию: враждебная — grumpy,
 * дружелюбная — happy.
 */

/** Фигурка ~4.25 в модельных единицах, старая модель была ~2.55. */
const WITCH_SCALE = 0.6;
/** Маркер дружелюбности в модельных координатах — над кончиком шляпы. */
const MARKER_LOCAL_Y = 4.4;
/** Локальный диаметр маркера: в мировых единицах 0.3 * WITCH_SCALE ≈ 0.18. */
const MARKER_LOCAL_DIAMETER = 0.3;

export class Witch {
  public readonly root: TransformNode;
  public readonly spell: Spell;
  public readonly id: string;
  public friendly: boolean;

  private readonly figure: WitchFigure;
  private readonly friendlyMarker: Mesh;
  private readonly friendlyMarkerMat: StandardMaterial;

  constructor(scene: Scene, position: Vector3, spell: Spell, id: string, initialFriendly = false) {
    this.id = id;
    this.spell = spell;
    this.friendly = initialFriendly;

    this.figure = createWitchFigure(scene, {
      namePrefix: id,
      robeColor: Color3.FromHexString(spell.color),
      scale: WITCH_SCALE,
    });
    this.root = this.figure.root;
    this.root.position = position;

    // Маленький зелёный огонёк над головой — виден только когда ведьма
    // дружелюбна, сигнализирует издалека "с этой можно спарринговать".
    this.friendlyMarkerMat = new StandardMaterial(`${id}_friendlyMarkerMat`, scene);
    this.friendlyMarkerMat.diffuseColor = Color3.FromHexString("#7be08a");
    this.friendlyMarkerMat.emissiveColor = Color3.FromHexString("#4fd66a");
    this.friendlyMarker = MeshBuilder.CreateSphere(`${id}_friendlyMarker`, { diameter: MARKER_LOCAL_DIAMETER }, scene);
    this.friendlyMarker.material = this.friendlyMarkerMat;
    this.friendlyMarker.position.y = MARKER_LOCAL_Y;
    this.friendlyMarker.parent = this.root;
    this.friendlyMarker.setEnabled(false);

    this.figure.playIdle();
    if (initialFriendly) this.applyFriendlyVisual();
    else this.applyHostileVisual();
  }

  /** Победа больше не убирает ведьму из мира — она остаётся, но перестаёт нападать. */
  public setFriendly(value: boolean): void {
    this.friendly = value;
    if (value) this.applyFriendlyVisual();
    else this.applyHostileVisual();
  }

  public playIdle(): void {
    this.figure.playIdle();
  }

  public stopIdle(): void {
    this.figure.stopIdle();
  }

  /** Взмах посохом (рандомизирован), после завершения idle возобновляется. */
  public swingStaff(onComplete?: () => void): void {
    this.figure.swingStaff(onComplete);
  }

  public setExpression(name: WitchExpression, frames?: number): void {
    this.figure.setExpression(name, frames);
  }

  public get position(): Vector3 {
    return this.root.position;
  }

  public dispose(): void {
    this.figure.dispose();
    this.friendlyMarkerMat.dispose();
  }

  private applyFriendlyVisual(): void {
    this.figure.hat.setEnabled(false); // сняла шляпу
    this.friendlyMarker.setEnabled(true);
    this.figure.robeMat.albedoColor = Color3.Lerp(this.figure.robeMat.albedoColor, Color3.White(), 0.55);
    this.figure.setExpression("happy");
  }

  private applyHostileVisual(): void {
    this.figure.hat.setEnabled(true);
    this.friendlyMarker.setEnabled(false);
    this.figure.robeMat.albedoColor = Color3.FromHexString(this.spell.color);
    this.figure.setExpression("grumpy");
  }
}