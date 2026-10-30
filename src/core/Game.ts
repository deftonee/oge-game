import { Vector3, Engine, Scene, ArcRotateCamera } from "@babylonjs/core";
import { createEngineSetup } from "./engineSetup";
import { setupLighting } from "./lighting";
import { createWorld } from "./worldSetup";
import { createPlayer, createOrbitCamera } from "./playerSetup";
import { EncounterCooldown } from "./encounterCooldown";
import { createManagers } from "./managers";
import { createInteraction } from "./interaction";
import { witchPowerFor } from "./duelRules";
import { createOpponentFactory } from "../combat/opponent";
import { BabylonBattleStage } from "../combat/stage/BabylonBattleStage";
import { PLAYER_REGEN_PER_SECOND } from "../combat/combatBalance";
import { ProximityDetector } from "../world/proximity";
import { GameState } from "./GameState";
import { MobileControls } from "../mobile/MobileControls";
import { OwlCompanion } from "../entities/OwlCompanion";
import { Backpack } from "../entities/Backpack";
import { ScreenProjector } from "./screenProjection";
import { KeyBindings } from "./KeyBindings";
import { applyCameraSettings, applyRenderScale } from "./applySettings";
import { SettingsStore } from "../settings/SettingsStore";
import { describeControlsHint } from "../settings/bindings";
import { FpsCounter } from "../ui/FpsCounter";
import { PauseMenu } from "../ui/pause/PauseMenu";
import { AutoSave } from "../save/AutoSave";
import { SaveStore } from "../save/SaveStore";
import { StealthManager } from "../stealth/StealthManager";
import { detectAutoTier, getQuality, qualityFromUrl } from "./quality";
import type { PlayerController } from "./PlayerController";
import { PlayerReactions } from "./PlayerReactions";
import type { ReactionState } from "./PlayerReactions";
import { ProgressWatcher, countProgress } from "./progressWatcher";
import type { GameManagers } from "./managers";
import type { WorldStreamer } from "../world/WorldStreamer";
import type { FogManager } from "../world/FogManager";

/** Как часто перерисовывать сцену под меню паузы (мир стоит; редкий кадр экономит батарею, но не даёт «пустого» экрана). */
const PAUSED_RENDER_INTERVAL_MS = 250;

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
  private readonly backpack: Backpack;
  private readonly settings: SettingsStore;
  private readonly keys: KeyBindings;
  private readonly fps: FpsCounter;
  private readonly lootPresenter: GameManagers["lootPresenter"];
  private readonly stealth: StealthManager;
  private readonly pause: PauseMenu;
  private readonly autoSave: AutoSave;
  private readonly hud: GameManagers["hud"];
  private readonly combat: GameManagers["combat"];
  private readonly learning: GameManagers["learning"];
  private readonly reactions: PlayerReactions;
  /** Состояние для реакций персонажа: один объект на всю игру, поля переписываются каждый кадр. */
  private readonly reactionState: ReactionState = { menuOpen: false, inCombat: false, atBonfire: false, hidden: false, powerFraction: 1, section: 0 };
  private readonly battleStage: BabylonBattleStage;
  private readonly playerPower: GameManagers["playerPower"];
  private readonly anyMenuOpen: () => boolean;
  /** Когда в последний раз рисовали кадр под паузой (0 — рисовать сразу). */
  private lastPausedRender = 0;
  /** Снимают слушатели, повешенные на document/window (см. dispose). */
  private readonly stopListening: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    const { engine, scene, emulateMobile } = createEngineSetup(canvas);
    this.engine = engine;
    this.scene = scene;

    setupLighting(scene);

    // Настройки игрока и ввод по действиям: клавиши берутся из настроек, а не зашиты в код.
    this.settings = new SettingsStore();
    this.keys = new KeyBindings(this.settings);

    const gameState = new GameState();
    const cooldown = new EncounterCooldown();
    this.cooldown = cooldown;

    // Продолжение: мир с тем же seed + прогресс и позиция из сохранения (если оно есть и мир тот же).
    const saves = new SaveStore();
    const { streamer, fog, spawnPoint, world, resumed } = createWorld(scene, gameState, saves.load());
    this.streamer = streamer;
    this.fog = fog;
    // Сразу после загрузки встреча не начинается в первую же секунду (запись могла быть сделана рядом с ведьмой).
    if (resumed) cooldown.notifyDuelEnded();

    const player = createPlayer(scene, spawnPoint, this.keys);
    this.player = player;
    this.camera = createOrbitCamera(scene, canvas, player);
    this.owl = new OwlCompanion(scene, player.position);

    // Рюкзак на спине: показывает собранные книги (после перезапуска/пересборки — сразу, без анимации).
    this.backpack = new Backpack(scene, player.backMount);
    this.backpack.syncBooks(gameState.getCollectedBookIds());

    // 3D-сцена боя: анимации ударов по школам и ракурсы камеры. На время боя мышь-камера отключается.
    this.battleStage = new BabylonBattleStage({
      scene,
      camera: this.camera,
      player,
      input: { detach: () => this.camera.detachControl(), attach: () => this.camera.attachControl(canvas, true) },
    });

    const managers = createManagers(uiRoot, gameState, cooldown, this.battleStage);
    this.hud = managers.hud;
    this.combat = managers.combat;
    this.learning = managers.learning;
    this.playerPower = managers.playerPower;
    this.fps = new FpsCounter(uiRoot);

    // Автосохранение: при изменении прогресса, при скрытии/закрытии вкладки, по таймеру и при паузе.
    const autoSave = new AutoSave({
      store: saves,
      gameState,
      world,
      initialPlayer: { x: spawnPoint.x, z: spawnPoint.z },
      // В бою позицию не обновляем: иначе продолжение началось бы прямо посреди схватки.
      getPlayer: () => (managers.combat.isActive ? null : { x: player.position.x, z: player.position.z }),
    });
    this.autoSave = autoSave;

    // Настройки действуют сразу: применяем при запуске и при каждом изменении в меню.
    const applySettings = (): void => {
      const { controls, graphics } = this.settings.get();
      applyCameraSettings(this.camera, controls);
      applyRenderScale(engine, graphics.renderScale);
      this.fps.setVisible(graphics.showFps);
      this.hud.setControlsHint(describeControlsHint(controls.bindings));
      // Смена масштаба рендера очищает канвас: под паузой перерисовываем в ближайшем кадре, а не через 250 мс.
      this.lastPausedRender = 0;
    };
    this.settings.subscribe(applySettings);
    applySettings();
    this.lootPresenter = managers.lootPresenter;

    // Стелс: кусты прячут игрока, ведьмы видят конусом и ходят сами.
    const stealth = new StealthManager(scene, player, streamer);
    this.stealth = stealth;

    // Сила ведьмы зависит от секции, в которой игрок встретил её (первая — тренировочная).
    const opponents = createOpponentFactory(() => witchPowerFor(streamer.sectionAt(player.position.x, player.position.z)));

    const proximity = new ProximityDetector({
      player,
      streamer,
      gameState,
      combat: managers.combat,
      hud: managers.hud,
      cooldown,
      opponents,
      isPlayerHidden: () => stealth.isHidden,
    });
    this.proximity = proximity;

    // Пауза: меню создаётся здесь, а не в interaction — ему нужны настройки, состояние и сцена.
    this.pause = new PauseMenu(uiRoot, {
      gameState,
      settings: this.settings,
      // «Новая игра»: стираем сохранение (и отключаем автосохранение — иначе закрытие страницы
      // записало бы его заново) и перезапускаем страницу: мир создастся с новым seed.
      onNewGame: () => {
        autoSave.discard();
        window.location.reload();
      },
      canSave: () => saves.available,
      isPauseKey: (e) => this.keys.matches("pause", e),
      // mobile появится ниже (его создаёт interaction); меню спрашивает только при открытии настроек.
      isTouch: () => this.mobile.isActive,
      activeTier: () => getQuality().tier,
      autoTier: detectAutoTier,
      qualityFromUrl: () => qualityFromUrl() !== null,
      onOpen: () => {
        // Позиция и прогресс — на диске в момент паузы (дальше игрок может закрыть вкладку).
        autoSave.flush();
        // Зажатые клавиши «забываем»: keydown/keyup во время паузы до KeyBindings не доходят.
        this.keys.clearPressed();
        // Часы анимаций Babylon идут по реальному времени: с нулевым масштабом ведьмы и посохи
        // стоят, а после паузы не «перематываются» на её длину.
        scene.animationTimeScale = 0;
      },
      onClose: () => {
        scene.animationTimeScale = 1;
      },
    });

    // Живые реакции персонажа: стена, костёр, «действие» без цели, стойка в бою, посадка у костра.
    this.reactions = new PlayerReactions(player, {
      activeBonfires: () => streamer.getActiveBonfires(),
      activeWitches: () => streamer.getActiveWitches(),
      activeChests: () => streamer.getActiveChests(),
    });
    // Радуется, когда у игрока что-то прибавилось (заклинание, барьер, книга или страница). Точка отсчёта —
    // состояние на старте, поэтому загруженный прогресс радости не вызывает.
    const progress = new ProgressWatcher(() => countProgress(gameState));
    gameState.subscribe(() => this.reactions.onProgress(progress.poll()));

    const interaction = createInteraction({
      reactions: this.reactions,
      managers,
      proximity,
      gameState,
      keys: this.keys,
      backpack: this.backpack,
      screen: new ScreenProjector(scene, this.camera, engine, () => canvas.getBoundingClientRect()),
      opponents,
      emulateMobile,
      pause: this.pause,
    });
    this.mobile = interaction.mobile;
    this.anyMenuOpen = interaction.anyMenuOpen;

    // Проксимити спрашивает про мобильные контролы только для текста подсказок;
    // связать с реальным инстансом можно только после его создания.
    proximity.bindMobile(() => this.mobile.isActive);

    // Debug-панель Babylon Inspector: динамический импорт, чтобы не тянуть
    // её в прод-сборку (import.meta.env.DEV === false → tree-shaken в build).
    // Поднимается по Backquote (`), закрывается повторно или по Esc.
    this.stopListening.push(this.bindInspectorHotkey());

    // Автопауза: вкладку скрыли (свернули браузер, переключились на другое приложение) — игра встаёт
    // на паузу. Только скрытие: потеря фокуса окна срабатывает от клика в devtools/iframe и мешала бы.
    const onVisibilityChange = (): void => {
      if (document.hidden) interaction.requestPause();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    this.stopListening.push(() => document.removeEventListener("visibilitychange", onVisibilityChange));

    this.startRenderLoop();
  }

  /** Вешает горячую клавишу инспектора (только в dev). Возвращает функцию, которая её снимает. */
  private bindInspectorHotkey(): () => void {
    // Vite заменяет import.meta.env.DEV статически; в проде блок вырезается.
    if (!import.meta.env.DEV) return () => {};
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
    const onKeyDown = (e: KeyboardEvent): void => {
      // Backquote (`) — без шорткатов-модификаторов; не срабатывает в input/textarea,
      // чтобы не мешать вводу текста в меню/чате.
      if (e.key !== "`" || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      void toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }

  private startRenderLoop(): void {
    const { engine, scene, player, camera, streamer, fog, cooldown, proximity, mobile, owl, backpack, lootPresenter, stealth, hud, pause, combat, learning, reactions, reactionState, playerPower, battleStage } = this;

    engine.runRenderLoop(() => {
      // Пауза: мир стоит (никаких апдейтов), а сцена перерисовывается редко — только чтобы
      // за меню не было пустого канваса (после resize/смены разрешения он очищается).
      if (pause.isOpen) {
        mobile.setVisible(false);
        const now = performance.now();
        if (now - this.lastPausedRender >= PAUSED_RENDER_INTERVAL_MS) {
          this.lastPausedRender = now;
          scene.render();
        }
        return;
      }

      const dt = engine.getDeltaTime() / 1000;
      cooldown.tick(dt);
      this.fps.update(engine.getFps(), dt);

      // Сила игрока восстанавливается сама, пока он не в бою.
      if (!combat.isActive) playerPower.recover(PLAYER_REGEN_PER_SECOND * dt);

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
      backpack.update(dt);
      lootPresenter.update(dt);

      // Сцена боя: анимации ударов и ракурсы камеры (в простое ничего не считает).
      battleStage.update(dt);

      // Камера мягко следует за игроком — кроме боя: там ею управляет сцена боя.
      if (!battleStage.controlsCamera) {
        camera.target = Vector3.Lerp(camera.target, player.position, Math.min(1, dt * 8));
      }

      // Держим в памяти только текущую секцию и её соседей; туман прячет
      // неотрисованный участок до башни.
      streamer.update(player.position.x, player.position.z);
      fog.update(streamer.frontierIndex(), dt);

      // Стелс ПЕРЕД проксимити: сначала ведьмы сделали шаг и обновилась «спрятан ли игрок»,
      // и уже по свежим позициям проверяем, не началась ли встреча.
      stealth.update(dt, menuOpen);
      hud.setStealthBadge(stealth.isHidden ? "🌿 В укрытии — ведьмы тебя не видят" : null);

      // Реакции персонажа — по свежему движению и стелсу: упёрся в стену, наступил на костёр, сидит у огня.
      reactionState.menuOpen = menuOpen;
      reactionState.inCombat = combat.isActive;
      reactionState.atBonfire = learning.isActive;
      reactionState.hidden = stealth.isHidden;
      reactionState.powerFraction = playerPower.fraction;
      reactionState.section = streamer.sectionAt(player.position.x, player.position.z);
      reactions.update(dt, reactionState);

      proximity.update(menuOpen);

      scene.render();
    });
  }

  public dispose(): void {
    this.engine.stopRenderLoop();
    for (const stop of this.stopListening) stop();
    this.autoSave.dispose();
    this.pause.close();
    this.owl.dispose();
    this.backpack.dispose();
    this.lootPresenter.dispose();
    this.battleStage.dispose();
    this.keys.dispose();
    this.fps.dispose();
  }
}