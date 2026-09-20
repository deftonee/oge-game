import { Vector3, Engine, Scene, ArcRotateCamera } from "@babylonjs/core";
import { createEngineSetup } from "./engineSetup";
import { setupLighting } from "./lighting";
import { createWorld } from "./worldSetup";
import { createPlayer, createOrbitCamera } from "./playerSetup";
import { EncounterCooldown } from "./encounterCooldown";
import { createManagers } from "./managers";
import { createInteraction } from "./interaction";
import { duelRoundsFor } from "./duelRules";
import { ProximityDetector } from "../world/proximity";
import { GameState } from "./GameState";
import { MobileControls } from "../mobile/MobileControls";
import { OwlCompanion } from "../entities/OwlCompanion";
import type { PlayerController } from "./PlayerController";
import type { WorldStreamer } from "../world/WorldStreamer";
import type { FogManager } from "../world/FogManager";

/**
 * Композиционный корень: собирает сцену, мир, игрока, камеру, менеджеры,
 * ввод и проксимити-детект в один игровой объект и гоняет render loop.
 * Вся предметная логика живёт в под-модулях — здесь только связывание.
 */
export class Game {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly player: PlayerController;
  private readonly camera: ArcRotateCamera;
  private readonly streamer: WorldStreamer;
  private readonly fog: FogManager;
  private readonly cooldown: EncounterCooldown;
  private readonly proximity: ProximityDetector;
  private readonly mobile: MobileControls;
  private readonly owl: OwlCompanion;
  private readonly anyMenuOpen: () => boolean;
  private readonly duelRoundsToWin: () => number;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    const { engine, scene, emulateMobile } = createEngineSetup(canvas);
    this.engine = engine;
    this.scene = scene;

    setupLighting(scene);

    const gameState = new GameState();
    const cooldown = new EncounterCooldown();
    this.cooldown = cooldown;

    const { streamer, fog, spawnPoint } = createWorld(scene, gameState);
    this.streamer = streamer;
    this.fog = fog;

    const player = createPlayer(scene, spawnPoint);
    this.player = player;
    this.camera = createOrbitCamera(scene, canvas, player);
    this.owl = new OwlCompanion(scene, player.position);

    const managers = createManagers(uiRoot, gameState, cooldown);

    this.duelRoundsToWin = () =>
      duelRoundsFor(streamer.sectionAt(player.position.x, player.position.z));

    const proximity = new ProximityDetector({
      player,
      streamer,
      gameState,
      combat: managers.combat,
      hud: managers.hud,
      cooldown,
      duelRoundsToWin: this.duelRoundsToWin,
    });
    this.proximity = proximity;

    const interaction = createInteraction({
      managers,
      proximity,
      gameState,
      duelRoundsToWin: this.duelRoundsToWin,
      emulateMobile,
    });
    this.mobile = interaction.mobile;
    this.anyMenuOpen = interaction.anyMenuOpen;

    // Проксимити спрашивает про мобильные контролы только для текста подсказок;
    // связать с реальным инстансом можно только после его создания.
    proximity.bindMobile(() => this.mobile.isActive);

    // Debug-панель Babylon Inspector: динамический импорт, чтобы не тянуть
    // её в прод-сборку (import.meta.env.DEV === false → tree-shaken в build).
    // Поднимается по Backquote (`), закрывается повторно или по Esc.
    this.bindInspectorHotkey(canvas);

    this.startRenderLoop();
  }

  private bindInspectorHotkey(canvas: HTMLCanvasElement): void {
    // Vite заменяет import.meta.env.DEV статически; в проде блок вырезается.
    if (!import.meta.env.DEV) return;
    let loaded = false;
    let inspectorVisible = false;
    const toggle = async (): Promise<void> => {
      try {
        if (!loaded) {
          // Inspector — отдельный пакет: side-effect-импорт цепляет класс
          // BABYLON.Debug к window. Без него scene.debugLayer.show() падает
          // с "BJSINSPECTOR is undefined" / "BABYLON.Debug is undefined"
          // (Babylon 7.x: класс лежит в @babylonjs/inspector, а не в core).
          await import("@babylonjs/inspector");
          loaded = true;
        }
        if (inspectorVisible) {
          this.scene.debugLayer.hide();
          inspectorVisible = false;
        } else {
          this.scene.debugLayer.show({ overlay: true, embedMode: true });
          inspectorVisible = true;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[debug] failed to toggle Babylon Inspector:", err);
      }
    };
    window.addEventListener("keydown", (e) => {
      // Backquote (`) — без шорткатов-модификаторов; не срабатывает в input/textarea,
      // чтобы не мешать вводу текста в меню/чате.
      if (e.key !== "`" || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      void toggle();
    });
    // Не блокируем canvas-фокус — Inspector накладывается через overlay.
    void canvas;
  }

  private startRenderLoop(): void {
    const { engine, scene, player, camera, streamer, fog, cooldown, proximity, mobile, owl } = this;

    engine.runRenderLoop(() => {
      const dt = engine.getDeltaTime() / 1000;
      cooldown.tick(dt);

      const menuOpen = this.anyMenuOpen();
      player.inputLocked = menuOpen;

      // Мобильное управление: прячем во время меню, вектор стика отдаём кадр в кадр.
      mobile.setVisible(!menuOpen);
      player.setJoystick(mobile.getMoveVector());

      const forward = camera.getDirection(Vector3.Forward());
      const right = camera.getDirection(Vector3.Right());
      player.update(dt, forward, right);

      // Сова летит по орбите вокруг игрока; пересчитываем ПОСЛЕ player.update,
      // чтобы целевая позиция брала уже обновлённую точку.
      owl.update(dt, player.position);

      // Камера мягко следует за игроком.
      camera.target = Vector3.Lerp(camera.target, player.position, Math.min(1, dt * 8));

      // Держим в памяти только текущую секцию и её соседей; туман прячет
      // неотрисованный участок до башни.
      streamer.update(player.position.x, player.position.z);
      fog.update(streamer.frontierIndex(), dt);

      proximity.update(menuOpen);

      scene.render();
    });
  }

  public dispose(): void {
    this.engine.stopRenderLoop();
    this.owl.dispose();
  }
}