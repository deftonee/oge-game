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
      duelRoundsToWin: this.duelRoundsToWin,
      emulateMobile,
    });
    this.mobile = interaction.mobile;
    this.anyMenuOpen = interaction.anyMenuOpen;

    // Проксимити спрашивает про мобильные контролы только для текста подсказок;
    // связать с реальным инстансом можно только после его создания.
    proximity.bindMobile(() => this.mobile.isActive);

    this.startRenderLoop();
  }

  private startRenderLoop(): void {
    const { engine, scene, player, camera, streamer, fog, cooldown, proximity, mobile } = this;

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
  }
}