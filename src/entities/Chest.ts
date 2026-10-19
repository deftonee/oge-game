import {
  Color3,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { Book, BookPage, getBookById, getBookPageById } from "../data/books";
import { GameState } from "../core/GameState";
import { resolveChestLoot } from "../learning/chestLoot";

/** Высота (м) точки над крышкой сундука: верх крышки (0.84) с небольшим запасом. */
const CHEST_OPENING_HEIGHT = 0.9;

export interface ChestOptions {
  id: string;
  /** Точное содержимое (рукописные сундуки). У динамических сундуков пусто. */
  bookIds: string[];
  pageIds?: string[];
  /** Динамический сундук: содержимое подбирается при открытии под состояние игрока. */
  dynamicSlots?: number;
}

export interface ChestContents {
  books: Book[];
  pages: BookPage[];
}

/**
 * Сундук с обучающим материалом: книгами (ветки прокачки) и страницами
 * (заклинания). Что именно внутри — решает resolveChestLoot при открытии.
 *
 * Entity отвечает только за модель и открытие. Факт открытия и найденное
 * хранятся в GameState, чтобы состояние переживало пересборку секции
 * WorldStreamer.
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

  /** Точка над крышкой (мировые координаты): отсюда «вылетают» находки при открытии. */
  public get openingPoint(): Vector3 {
    return this.root.position.add(new Vector3(0, CHEST_OPENING_HEIGHT, 0));
  }

  public get isOpened(): boolean {
    return this.opened;
  }

  /**
   * Содержимое: у открытого сундука — то, что в нём нашли (хранится в GameState);
   * у закрытого рукописного — то, что в нём указано; у закрытого динамического — пусто
   * (оно ещё не определено).
   */
  public getContents(): ChestContents {
    const loot = this.gameState.getChestLoot(this.id) ?? {
      bookIds: this.opts.bookIds,
      pageIds: this.opts.pageIds ?? [],
    };
    return {
      books: loot.bookIds.map((id) => getBookById(id)).filter((b): b is Book => !!b),
      pages: loot.pageIds.map((id) => getBookPageById(id)).filter((p): p is BookPage => !!p),
    };
  }

  /**
   * Открывает сундук один раз: определяет содержимое, переносит найденное в
   * коллекцию игрока и возвращает его. Повторное взаимодействие безопасно —
   * сундук просто возвращает то, что в нём было.
   */
  public open(): ChestContents {
    if (!this.opened) {
      const loot = resolveChestLoot(
        {
          bookIds: this.opts.bookIds,
          pageIds: this.opts.pageIds ?? [],
          dynamic: this.opts.dynamicSlots !== undefined ? { slots: this.opts.dynamicSlots } : undefined,
        },
        this.gameState
      );
      this.gameState.recordChestLoot(this.id, loot);
      this.opened = true;
      this.applyOpenedVisual();
    }
    return this.getContents();
  }

  private syncState(): void {
    this.opened = this.gameState.isChestOpen(this.id);
    if (this.opened) this.applyOpenedVisual();
  }

  /** Разборка сундука при выгрузке чанка (WorldStreamer: build/dispose секций). */
  public dispose(): void {
    // Материалы не наследуются dispose() узла — освобождаем явно (уникальные).
    const materials = new Set<StandardMaterial>();
    for (const m of this.root.getChildMeshes()) {
      if (m.material) materials.add(m.material as StandardMaterial);
    }
    this.root.dispose();
    for (const mat of materials) mat.dispose();
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
      dynamic: this.opts.dynamicSlots !== undefined,
    };
    return root;
  }

  /** Визуал открытого сундука: крышка поднята. Не храним ссылку — ищем по имени. */
  private applyOpenedVisual(): void {
    const lid = this.root.getChildMeshes().find((m) => m.name === `chestLid_${this.id}`);
    if (lid) lid.rotation.x = -Math.PI / 3;
  }
}
