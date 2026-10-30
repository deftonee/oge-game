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
import { WitchBrain, type WitchAiState } from "../ai/witchBrain";

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
/** Маркер тревоги (над шляпой, на месте зелёного огонька — они не бывают вместе). */
const ALERT_LOCAL_DIAMETER = 0.5;
const ALERT_NOTICE_COLOR = "#fff04a"; // «!?» — только что заметила, замерла
const ALERT_SEARCH_COLOR = "#ffa53d"; // «?» — потеряла игрока (ищет) или стоит и наблюдает
const ALERT_CHASE_COLOR = "#ff4a4a"; // «!» — увидела игрока, идёт к нему

/**
 * Невидимый коллайдер ведьмы: нужен только чтобы стены, ворота и игрок не
 * пропускали её при ходьбе (сама она ни для кого не препятствие). Центр выше
 * пола на 1 м и нижняя точка эллипсоида на 0.1 м над полом — об пол не трётся.
 */
const COLLIDER_Y = 1.0;
const COLLIDER_ELLIPSOID = new Vector3(0.45, 0.9, 0.45);
/** Как часто пересчитывать прямую видимость (луч по стенам) — не каждый кадр. */
const LOS_INTERVAL = 0.12;
/** Сколько секунд ведьма после проигранной/брошенной дуэли «не замечает» игрока. */
const DISENGAGE_IGNORE_SECONDS = 6;
/** Дружелюбная ведьма замирает, когда игрок ближе (чтобы можно было спокойно спарринговать). */
const FRIENDLY_FREEZE_DISTANCE = 4;
/** Подпрыгивание при ходьбе (м): простая «походка» без скелетной анимации. */
const WALK_BOB_HEIGHT = 0.05;

/** Что ведьме нужно знать о мире, чтобы «подумать» за один кадр (см. StealthManager). */
export interface WitchAiContext {
  playerX: number;
  playerZ: number;
  /** Игрок в кусте — ведьмы его не видят. */
  playerHidden: boolean;
  /**
   * Индекс секции, в которой сейчас игрок. Ведьма не покидает свою секцию: когда игрок
   * ушёл за границу, погоня превращается в наблюдение. Не задан — считаем, что в её секции.
   */
  playerSectionIndex?: number;
  /** Открыто меню/бой — мир стоит. */
  paused: boolean;
  /** Прямая видимость по стенам: true — ничто не перекрывает. */
  lineOfSight: (fromX: number, fromZ: number, toX: number, toZ: number) => boolean;
}

export class Witch {
  public readonly root: TransformNode;
  public readonly spell: Spell;
  public readonly id: string;
  public friendly: boolean;

  private readonly figure: WitchFigure;
  private readonly friendlyMarker: Mesh;
  private readonly friendlyMarkerMat: StandardMaterial;
  private readonly alertMarker: Mesh;
  private readonly alertMarkerMat: StandardMaterial;
  private readonly collider: Mesh;
  private readonly brain: WitchBrain;
  private losTimer = 0;
  private losCached = false;
  private bobPhase = 0;
  /** Секция, в которой ведьма живёт (ставит SectionChunk). −1 — не задана (считается «везде»). */
  public sectionIndex = -1;

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

    // Маркер тревоги: жёлтый — ищет игрока, красный — идёт к нему.
    this.alertMarkerMat = new StandardMaterial(`${id}_alertMarkerMat`, scene);
    this.alertMarkerMat.diffuseColor = Color3.Black();
    this.alertMarkerMat.emissiveColor = Color3.FromHexString(ALERT_SEARCH_COLOR);
    this.alertMarkerMat.specularColor = Color3.Black();
    this.alertMarker = MeshBuilder.CreateSphere(`${id}_alertMarker`, { diameter: ALERT_LOCAL_DIAMETER }, scene);
    this.alertMarker.material = this.alertMarkerMat;
    this.alertMarker.position.y = MARKER_LOCAL_Y;
    this.alertMarker.parent = this.root;
    this.alertMarker.isPickable = false;
    this.alertMarker.setEnabled(false);

    // «Дом» ведьмы — точка спавна (генератор ставит её рядом с сундуком): гуляет вокруг неё.
    this.collider = MeshBuilder.CreateBox(`${id}_collider`, { width: 0.9, height: 1.8, depth: 0.9 }, scene);
    this.collider.isVisible = false;
    this.collider.isPickable = false;
    this.collider.checkCollisions = false; // сама ни для кого не препятствие
    this.collider.ellipsoid = COLLIDER_ELLIPSOID.clone();
    this.collider.position.set(position.x, COLLIDER_Y, position.z);
    this.brain = new WitchBrain(position.x, position.z, Math.random() * Math.PI * 2);
    this.root.rotation.y = this.brain.yaw;

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

  /** Текущее состояние ИИ (для отладки и тестов). */
  public get aiState(): WitchAiState {
    return this.brain.state;
  }

  /**
   * Насколько ведьма встревожена из-за игрока: none — спокойна (или дружелюбна), notice — что-то заметила,
   * chase — гонится, search — потеряла и ищет. Нужен реакциям героя (оглянуться, замереть, выдохнуть).
   */
  public get alertLevel(): "none" | "notice" | "search" | "chase" {
    return this.friendly ? "none" : this.brain.alert;
  }

  /** Ведьма враждебна и в этот момент видит игрока (заметила или идёт к нему) — при встрече она бьёт первой. */
  public get hasSpottedPlayer(): boolean {
    return !this.friendly && this.brain.hasSpottedPlayer;
  }

  /**
   * Развернуться лицом к точке (в бою — к игроку). Курс запоминает и мозг: иначе после боя
   * ИИ вернул бы ведьму на прежний курс рывком.
   */
  public faceToward(x: number, z: number): void {
    const yaw = Math.atan2(x - this.root.position.x, z - this.root.position.z);
    this.brain.yaw = yaw;
    this.root.rotation.y = yaw;
  }

  /** Курс ведьмы (рад, 0 = +Z) — куда направлен её конус обзора. */
  public get facingYaw(): number {
    return this.brain.yaw;
  }

  /**
   * Дуэль проиграна/брошена: ведьма «отцепляется», идёт домой и несколько
   * секунд не замечает игрока (иначе бой перезапускался бы бесконечно).
   */
  public disengage(): void {
    this.brain.disengage(DISENGAGE_IGNORE_SECONDS);
  }

  /**
   * Один кадр «жизни» ведьмы: зрение → решение → ходьба с коллизиями.
   * Вызывается из StealthManager. Во время меню/боя мир стоит (paused).
   */
  public updateAi(rawDt: number, ctx: WitchAiContext): void {
    if (ctx.paused) return;
    const dt = Math.min(rawDt, 0.1); // после паузы вкладки не телепортируемся
    if (!(dt > 0)) return;

    const pos = this.root.position;

    // Дружелюбная при игроке стоит смирно — спарринг по E не «убегает» из-под носа.
    if (this.friendly && Math.hypot(ctx.playerX - pos.x, ctx.playerZ - pos.z) < FRIENDLY_FREEZE_DISTANCE) {
      this.settleBob(dt);
      return;
    }

    this.losTimer -= dt;
    const out = this.brain.tick(dt, {
      x: pos.x,
      z: pos.z,
      playerX: ctx.playerX,
      playerZ: ctx.playerZ,
      playerHidden: ctx.playerHidden,
      canDetect: !this.friendly,
      playerInTerritory:
        this.sectionIndex < 0 || ctx.playerSectionIndex === undefined || ctx.playerSectionIndex === this.sectionIndex,
      lineOfSight: () => {
        if (this.losTimer <= 0) {
          this.losCached = ctx.lineOfSight(pos.x, pos.z, ctx.playerX, ctx.playerZ);
          this.losTimer = LOS_INTERVAL;
        }
        return this.losCached;
      },
    });

    this.root.rotation.y = out.yaw;
    this.walk(dt, out.vx, out.vz);
    this.updateAlertMarker();
  }

  public dispose(): void {
    this.collider.dispose();
    this.figure.dispose();
    this.friendlyMarkerMat.dispose();
    this.alertMarkerMat.dispose();
  }

  /** Шаг по XZ через коллайдер (стены/ворота/игрок останавливают), Y корня — только лёгкое подпрыгивание. */
  private walk(dt: number, vx: number, vz: number): void {
    if (vx === 0 && vz === 0) {
      this.settleBob(dt);
      return;
    }
    const pos = this.root.position;
    this.collider.position.set(pos.x, COLLIDER_Y, pos.z);
    // moveWithCollisions считает от getAbsolutePosition(), а матрица мира обновляется только при
    // рендере: без пересчёта коллизия шла бы от устаревшей точки (например, в кадре сборки секции).
    this.collider.computeWorldMatrix(true);
    this.collider.moveWithCollisions(new Vector3(vx * dt, 0, vz * dt));
    pos.x = this.collider.position.x;
    pos.z = this.collider.position.z;

    this.bobPhase += dt * Math.hypot(vx, vz) * 5;
    pos.y = WALK_BOB_HEIGHT * Math.abs(Math.sin(this.bobPhase));
  }

  private settleBob(dt: number): void {
    const pos = this.root.position;
    if (pos.y > 0) pos.y = Math.max(0, pos.y - dt * 0.3);
  }

  private updateAlertMarker(): void {
    const alert = this.friendly ? "none" : this.brain.alert;
    if (alert === "none") {
      if (this.alertMarker.isEnabled()) this.alertMarker.setEnabled(false);
      return;
    }
    const color = alert === "chase" ? ALERT_CHASE_COLOR : alert === "notice" ? ALERT_NOTICE_COLOR : ALERT_SEARCH_COLOR;
    this.alertMarkerMat.emissiveColor = Color3.FromHexString(color);
    if (!this.alertMarker.isEnabled()) this.alertMarker.setEnabled(true);
  }

  private applyFriendlyVisual(): void {
    this.figure.hat.setEnabled(false); // сняла шляпу
    this.friendlyMarker.setEnabled(true);
    this.alertMarker.setEnabled(false);
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