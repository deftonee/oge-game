import {
  Color3,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { Book, getBookById } from "../data/books";
import { GameState } from "../core/GameState";

export interface ChestOptions {
  id: string;
  bookIds: string[];
  pageIds?: string[];
}

export interface ChestContents {
  books: Book[];
  pageIds: string[];
}

/**
 * Сундук с обучающим материалом.
 *
 * Entity отвечает только за модель и содержимое.
 * Факт открытия хранится в GameState, чтобы состояние переживало
 * пересборку секции WorldStreamer.
 */
export class Chest {
  public readonly root: TransformNode;
  private opened = false;

  constructor(
    private readonly scene: Scene,
    position: Vector3,
    public readonly opts: ChestOptions,
    private readonly gameState: GameState,
  ) {
    this.root = this.buildModel();
    this.root.position.copyFrom(position);
    this.syncState();
  }

  public get id(): string {
    return this.opts.id;
  }

  public get position(): Vector3 {
    return this.root.position;
  }

  public get isOpened(): boolean {
    return this.opened;
  }

  public getContents(): ChestContents {
    return {
      books: this.opts.bookIds
        .map((id) => getBookById(id))
        .filter((book): book is Book => !!book),
      pageIds: [...(this.opts.pageIds ?? [])],
    };
  }

  /**
   * Открывает сундук один раз и возвращает его содержимое.
   * Повторное взаимодействие безопасно: сундук просто возвращает содержимое.
   */
  public open(): ChestContents {
    if (!this.opened) {
      this.opened = true;
      this.gameState.openChest(this.id);
      this.applyOpenedVisual();
    }
    return this.getContents();
  }

  private syncState(): void {
    this.opened = this.gameState.isChestOpen(this.id);
    if (this.opened) this.applyOpenedVisual();
  }

  private buildModel(): TransformNode {
    const root = new TransformNode(`chest_${this.id}`, this.scene);

    const wood = new StandardMaterial(`chestWood_${this.id}`, this.scene);
    wood.diffuseColor = Color3.FromHexString("#6b4025");
    wood.specularColor = Color3.Black();

    const metal = new StandardMaterial(`chestMetal_${this.id}`, this.scene);
    metal.diffuseColor = Color3.FromHexString("#b08a45");
    metal.specularColor = Color3.Black();

    const body = MeshBuilder.CreateBox(
      `chestBody_${this.id}`,
      { width: 1.25, height: 0.7, depth: 0.8 },
      this.scene,
    );
    body.material = wood;
    body.position.y = 0.35;
    body.parent = root;

    const lid = MeshBuilder.CreateBox(
      `chestLid_${this.id}`,
      { width: 1.3, height: 0.16, depth: 0.84 },
      this.scene,
    );
    lid.material = wood;
    lid.position.y = 0.76;
    lid.parent = root;

    const lock = MeshBuilder.CreateBox(
      `chestLock_${this.id}`,
      { width: 0.16, height: 0.22, depth: 0.08 },
      this.scene,
    );
    lock.material = metal;
    lock.position.set(0, 0.47, -0.44);
    lock.parent = root;

    root.metadata = {
      kind: "chest",
      chestId: this.id,
      bookIds: [...this.opts.bookIds],
      pageIds: [...(this.opts.pageIds ?? [])],
    };
