import { PSG } from "../audio/psg";
import { ModulationParams, ModulationPresetResolver, RandomModulationParams, SoundMaster, SoundMasterPlayRequest } from "../audio/soundmaster";
import { showRewindDialog } from "../debugger/rewindui";
import { Input } from "../input/input";
import type { InputMap, VibrationParams } from "../input/inputtypes";
import { ActionState, ActionStateQuery } from '../input/inputtypes';
import { PhysicsWorld } from '../physics/physicsworld';
import { GameView } from "../render/gameview";
import { TextureManager } from "../render/texturemanager";
import { RenderPassLibrary } from "../render/backend/renderpasslib";
import { ensureBrowserBackendFactory } from "../render/backend/browser_backend_factory";
import type { SkyboxImageIds } from "../render/shared/render_types";
import { HZ_SCALE as PLATFORM_HZ_SCALE, setMicrotaskQueue } from '../platform';
import type { GameViewHost, Platform, PlatformExitEvent, SubscriptionHandle } from '../platform';
import { asset_id, getMachineMaxVoices, Identifiable, Identifier, Registerable, RuntimeAssets, type vec3, type vec2, GAME_FPS } from "../rompack/rompack";
import { tokenKeyFromId } from '../util/asset_tokens';
import { AssetSourceStack, type RawAssetSource } from '../rompack/asset_source';
import { buildRuntimeAssetLayer, normalizeCartridgeBlob, parseCartridgeIndex, type RuntimeAssetLayer } from '../rompack/romloader';
import type { LuaSourceRegistry } from '../emulator/lua_sources';
import { BinaryCompressor } from "../serializer/bincompressor";
import { Reviver, Savegame, Serializer } from "../serializer/gameserializer";
import { Service } from "./service";
import { RewindBuffer, RewindFrame } from "../serializer/rewind";
import { World, WorldConfiguration, type SpawnReason } from "./world";
import { EventEmitter } from "./eventemitter";
import { create_gameevent, EventPayload, GameEvent } from "./game_event";
import { GameplayEventRecorder } from './replay/gameplayeventrecorder';
import { WorldObject } from "./object/worldobject";
import { GameOptions } from './gameoptions';
import { Registry } from "./registry";
import { GateGroup, taskGate } from './taskgate';
// Choose and apply an ECS pipeline here (gameplay/headless)
import { DefaultECSPipelineRegistry } from "../ecs/pipeline";
import { TickGroup } from '../ecs/ecsystem';
import { registerBuiltinECS } from "../ecs/builtin_pipeline";
import type { NodeSpec } from "../ecs/pipeline";
import { collectEcsPipelineExtensionsFromWorldModules, } from "../ecs/extensions";
import { gameplaySpec } from './pipelines/gameplay_pipeline';
import { Runtime } from '../emulator/runtime';
import * as runtimeIde from '../emulator/runtime_ide';
import * as runtimeLuaPipeline from '../emulator/runtime_lua_pipeline';
import { createEmulatorModule } from '../emulator/module';
import type { GPUBackend } from '../render/backend/pipeline_interfaces';
import { ActionEffectRegistry } from '../action_effects/effect_registry';
import { InputSource, KeyModifier } from '../input/playerinput';
import { shallowcopy } from '../utils/shallowcopy';
import { clamp } from '../utils/clamp';
import { clearBackQueues } from '../render/shared/render_queues';
// No direct space helpers needed here; Spaces are revived as part of the world.

const globalScope: any = typeof window !== 'undefined' ? window : globalThis;
global = globalScope; // Ensure global is defined

// Register global variables
// Note that $ is defined at the bottom of the code file
export var $debug: boolean;

export interface EngineStartupOptions {
	engineRom: Uint8Array;
	cartridge?: Uint8Array;
	workspaceOverlay?: Uint8Array;
	worldConfig?: WorldConfiguration;
	sndcontext?: AudioContext;
	gainnode?: GainNode;
	debug?: boolean;
	startingGamepadIndex?: number;
	enableOnscreenGamepad?: boolean;
	/**
	 * ECS pipeline selection. Provide a spec or a pipeline id. Defaults to the platform's default pipeline.
	 */
	ecsPipeline?: NodeSpec[];
	platform: Platform;
	viewHost?: GameViewHost;
}

const MAX_FRAME_DELTA = 250;  // ms
const MAX_SUBSTEPS = 5;
const REWIND_BUFFER_ACTIVATED = true;
const REWIND_BUFFER_WRITE_FREQUENCY = 1; // Frames
const PRESENTATION_TICK_GROUPS: ReadonlyArray<TickGroup> = [TickGroup.Presentation, TickGroup.EventFlush];

export const HZ_SCALE = PLATFORM_HZ_SCALE;

export function calcCyclesPerFrameScaled(cpuHz: number, refreshHzScaled: number): number {
	if (!Number.isSafeInteger(cpuHz) || cpuHz <= 0) {
		throw new Error('[EngineCore] cpuHz must be a positive safe integer.');
	}
	if (!Number.isSafeInteger(refreshHzScaled) || refreshHzScaled <= 0) {
		throw new Error('[EngineCore] refreshHzScaled must be a positive safe integer.');
	}
	const numerator = cpuHz * HZ_SCALE;
	if (!Number.isSafeInteger(numerator) || numerator <= 0) {
		throw new Error('[EngineCore] cpuHz scaled numerator must be a positive safe integer.');
	}
	return Math.floor(numerator / refreshHzScaled);
}

export function calcCyclesPerFrame(cpuHz: number, refreshHz: number): number {
	if (!Number.isFinite(refreshHz) || refreshHz <= 0) {
		throw new Error('[EngineCore] refreshHz must be a positive number.');
	}
	const refreshHzScaled = Math.round(refreshHz * HZ_SCALE);
	return calcCyclesPerFrameScaled(cpuHz, refreshHzScaled);
}

// Gate to block the game update/run loop (used when loading/hydrating game state)
export const runGate: GateGroup = taskGate.group('run:main');
export const renderGate: GateGroup = taskGate.group('render:main');

/**
 * Represents the main game loop and manages the game state.
 */
export class EngineCore {
	private _debug: boolean = false;
	private initialized: boolean = false; // Indicates if the game has been initialized
	/**
	 * Indicates whether debug mode is enabled.
	 */
	public get debug(): boolean { return this._debug; }
	/**
	 * The target frames per second for the game.
	 */
	public target_fps: number = GAME_FPS;
	public ufps_scaled: number = GAME_FPS * HZ_SCALE;
	public get ufps(): number { return this.ufps_scaled / HZ_SCALE; }
	private update_interval_ms!: number; // ms per update = 1000 / fps
	/**
	 * The timestamp of the last update.
	 */
	public last_update: number = 0;
	/**
	 * The time difference between the current frame and the previous frame.
	 */
	public deltatime: number = 0;
	private debugTickReportAtMs: number = 0;
	private debugTickHostFrames: number = 0;
	private debugTickUpdates: number = 0;
	private cycleCarry: number = 0;

	public get timestep_ms(): number { return this.update_interval_ms; } // ms per update = 1000 / fps

	public get deltatime_seconds(): number { return this.deltatime / 1000; }

	public setUfpsScaled(ufpsScaled: number): void {
		if (!Number.isSafeInteger(ufpsScaled) || ufpsScaled <= HZ_SCALE) {
			throw new Error('[EngineCore] ufps scaled must be a safe integer greater than 1 Hz.');
		}
		this.ufps_scaled = ufpsScaled;
		this.target_fps = ufpsScaled / HZ_SCALE;
		if (this.initialized) {
			this.recomputeTimingCaches();
		}
	}

	public setUfps(ufps: number): void {
		if (!Number.isFinite(ufps) || ufps <= 0) {
			throw new Error('[EngineCore] ufps must be a positive number.');
		}
		const ufpsScaled = Math.round(ufps * HZ_SCALE);
		this.setUfpsScaled(ufpsScaled);
	}

	private _assets: RuntimeAssets = null;
	private _asset_source: RawAssetSource = null;
	private _lua_sources: LuaSourceRegistry = null;
	private _engine_layer: RuntimeAssetLayer = null;
	private _workspace_overlay: Uint8Array = null;
	private _sndcontext: AudioContext = null;
	private _gainnode: GainNode = null;

	/**
	 * The accumulated time in milliseconds.
	 */
	public accumulated_time: number = 0;

	/**
	 * The timestamp of the last game tick.
	 */
	last_gametick_time!: number;
	/**
	 * The turn counter for the game.
	 */
	_turnCounter!: number;
	/**
	 * The ID of the animation frame request.
	 */
	private frameLoopHandle: { stop(): void } = null;
	private _view!: GameView;
	private _platform!: Platform;
	/**
	 * Indicates whether the game is currently running.
	 */
	public running!: boolean;

	/**
	 * Indicates whether the game is currently paused (by the debugger).
	 */
	private _paused!: boolean;

	public get paused(): boolean { return this._paused; }
	public set paused(value: boolean) {
		if (this._paused === value) return; // No change
		this._paused = value;
		if (this._paused === true) {
			this.sndmaster.pause();
		}
		else if (this._paused === false) {
			this.sndmaster.resume();
		}
	}

	private _debuggerControlsVisible: boolean = false;

	public toggleDebuggerControls(): void {
		if (this._debuggerControlsVisible) {
			$.paused = false;
			this.hideDebuggerControls();
		} else {
			$.paused = true;
			this.showDebuggerControls();
		}
	}

	private showDebuggerControls(): void {
		this._debuggerControlsVisible = true;
		$.view.showPauseOverlay();
		showRewindDialog();
	}

	private hideDebuggerControls(): void {
		this._debuggerControlsVisible = false;
		$.view.showResumeOverlay();
		let rewindOverlay = document.getElementById('rewind-overlay');
		if (rewindOverlay) rewindOverlay.remove();
	}

	/**
	 * Indicates whether the game was updated.
	 * This property is used to track if any changes were made to the game before rendering a new frame.
	 */
	wasupdated!: boolean;

	/**
	 * Indicates whether the game should run a single frame and then pause for debugging purposes.
	 */
	public debug_runSingleFrameAndPause!: boolean;

	private removeWillExit: SubscriptionHandle = null;
	private _pipelineSpec: NodeSpec[] = []; // Note that the base spec already includes extensions, and is already a clone
	private _pipelineOverride: NodeSpec[] = []; // These nodes override the base spec when set during runtime. So they really replace the base spec until cleared.
	private _pipelineExt: NodeSpec[] = null; // These nodes override the base spec when set during runtime. Note that these are not extended with module nodes, as the modules are already included in the base spec at init time.
	private initialWorldConfigSnapshot: WorldConfiguration = null;

	public get assets(): RuntimeAssets { return this._assets; }
	public get asset_source(): RawAssetSource { return this._asset_source; }
	public get lua_sources(): LuaSourceRegistry { return this._lua_sources; }
	public get engine_layer(): RuntimeAssetLayer { return this._engine_layer; }
	public get workspace_overlay(): Uint8Array { return this._workspace_overlay; }
	public set_lua_sources(sources: LuaSourceRegistry): void {
		this._lua_sources = sources;
	}
	public set_asset_source(source: RawAssetSource): void {
		this._asset_source = source;
	}

	public get world(): World { return this.registry.get<World>('world')!; }

	public get view(): GameView { return this._view; }

	public get event_emitter(): EventEmitter { return EventEmitter.instance!; }
	public get events(): EventEmitter { return EventEmitter.instance!; }

	public get input(): Input { return Input.instance!; }
	public get texmanager(): TextureManager { return TextureManager.instance!; }
	public get registry(): Registry { return Registry.instance!; }
	public get sndmaster(): SoundMaster { return this.registry.get<SoundMaster>('sm')!; }
	public get ae_registry(): ActionEffectRegistry { return ActionEffectRegistry.instance; }
	public get platform(): Platform { return this._platform!; }


	public emit(event: GameEvent): void;
	public emit(event_name: string, emitter: Identifiable, payload?: EventPayload): void;
	public emit(arg0: GameEvent | string, emitter?: Identifiable, payload: EventPayload = {}): void {
		const e = typeof arg0 === 'string' ? create_gameevent({ type: arg0, emitter: emitter, ...payload }) : arg0;
		GameplayEventRecorder.instance.record(e);
		this.event_emitter.emit(e);
	}

	public get<T extends Registerable>(id: Identifier): T {
		return this.registry.get<T>(id);
	}

	public get_worldobject<T extends WorldObject>(id: Identifier): T {
		return this.world.getWorldObject<T>(id);
	}

	public resolve_ref_or_id<T extends Registerable>(ref_or_id: T | Identifier): T {
		if (typeof ref_or_id === 'string') {
			return this.registry.get<T>(ref_or_id);
		}
		return ref_or_id;
	}

	public has(id: Identifier): boolean {
		return this.registry.has(id);
	}

	public register(value: Registerable): void {
		this.registry.register(value);
	}

	public deregister(id: Identifier | Registerable): void {
		this.registry.deregister(id);
	}

	public spawn(o: WorldObject, pos?: vec3, opts?: { ignoreSpawnhandler?: boolean, reason?: SpawnReason }): void {
		this.world.spawn(o, pos, opts);
	}

	public exile(o: WorldObject): void { this.world.despawnFromAllSpaces(o); }

	public playaudio(id: asset_id, options?: RandomModulationParams | ModulationParams | string | SoundMasterPlayRequest): void {
		if (typeof options === 'string') {
			void this.sndmaster.play(id, { modulation_preset: options });
			return;
		}
		void this.sndmaster.play(id, options);
	}

	public stopmusic(): void {
		this.sndmaster.stopMusic();
	}

	public set_inputmap(playerIndex: number, map: InputMap): void {
		this.input.getPlayerInput(playerIndex).setInputMap(map);
	}

	public action_triggered(playerIndex: number, action: string): boolean {
		return this.input.getPlayerInput(playerIndex).checkActionTriggered(action);
	}

	public actions_triggered(playerIndex: number, ...actions: { id: string, def: string }[]): string[] {
		return this.input.getPlayerInput(playerIndex).checkActionsTriggered(...actions);
	}

	public get_action_state(playerIndex: number, action: string, window?: number) {
		return this.input.getPlayerInput(playerIndex).getActionState(action, window);
	}

	public get_key_state(playerIndex: number, keyCode: string, modifiers: KeyModifier) {
		return this.input.getPlayerInput(playerIndex).getKeyState(keyCode, modifiers);
	}

	/** @deprecated Use {@link action_triggered} / {@link actions_triggered} with ActionParser definitions instead. */
	public get_pressed_actions(playerIndex: number, query?: ActionStateQuery) {
		return this.input.getPlayerInput(playerIndex).getPressedActions(query);
	}

	public consume_action(playerIndex: number, actionToConsume: ActionState | string) {
		this.input.getPlayerInput(playerIndex).consumeAction(actionToConsume);
	}

	public consume_actions(playerIndex: number, ...actionsToConsume: (ActionState | string)[]) {
		this.input.getPlayerInput(playerIndex).consumeActions(...actionsToConsume);
	}

	public consume_button(playerIndex: number, buttonCode: string, source: InputSource) {
		this.input.getPlayerInput(playerIndex).consumeButton(buttonCode, source);
	}

	public apply_vibration_effect(playerIndex: number, effectParams: VibrationParams): void {
		if (!this.input.getPlayerInput(playerIndex).supportsVibrationEffect) return;
		this.input.getPlayerInput(playerIndex).applyVibrationEffect(effectParams);
	}

	public hide_onscreen_gamepad_buttons(gamepad_button_ids: string[]): void {
		this.input.hideOnscreenGamepadButtons(gamepad_button_ids);
	}

	public get viewportsize(): vec2 {
		return this.view.viewportSize;
	}

	private rewindBuffer: RewindBuffer;
	private readonly REWINDBUFFER_LENGTH_SECONDS: number = 60; // Length of the rewind buffer in seconds

	/**
	 * Constructs a new instance of the BMSX class.
	 */
	constructor() {
		this.initialized = false;
	}

	private recomputeTimingCaches(): void {
		this.update_interval_ms = 1000 / this.target_fps;
		this.rewindBuffer = new RewindBuffer(this.target_fps, this.REWINDBUFFER_LENGTH_SECONDS);
	}

	private buildModulationResolver(assets: RuntimeAssets): ModulationPresetResolver {
		return {
			resolve: (key: asset_id) => {
				const data = assets.data;
				const segments = key.split('.');
				if (segments.length === 0) {
					return undefined;
				}
				const rootKey = tokenKeyFromId(segments[0]);
				let cursor: unknown = (data as Record<string, unknown>)[rootKey];
				for (let i = 1; i < segments.length; i++) {
					const segment = segments[i];
					if (segment.length === 0) {
						cursor = undefined;
						break;
					}
					if (cursor && typeof cursor === 'object' && (cursor as Record<string, unknown>)[segment] !== undefined) {
						cursor = (cursor as Record<string, unknown>)[segment];
					} else {
						cursor = undefined;
						break;
					}
				}
				if (cursor && typeof cursor === 'object') {
					return cursor as (RandomModulationParams | ModulationParams);
				}
			},
		};
	}

	public async refresh_audio_assets(): Promise<void> {
		const resolver = this.buildModulationResolver(this._assets);
		const runtime = Runtime.instance;
		const resources = runtime.buildAudioResourcesForSoundMaster();
		await SoundMaster.instance.init(
			resources,
			GameOptions.volumePercentage,
			resolver,
			(id) => runtime.getAudioBytesById(id)
		);
		const maxVoices = getMachineMaxVoices(this._assets.manifest.machine);
		if (maxVoices) {
			SoundMaster.instance.setMaxVoicesByType(maxVoices);
		}
	}

	public set_skybox_imgs(ids: SkyboxImageIds): void {
		Runtime.instance.setSkyboxImages(ids);
	}

	/**
	 * Inits the game on boot.
	 * @param rom - The ROM pack containing game assets.
	 * @param model - The model object that manages the game state.
	 * @param view - The view object that manages the game display.
	 * @param sndcontext - The audio context used for playing sounds.
	 * @param gainnode - The gain node used for controlling the volume of sounds.
	 * @param debug - Whether to enable debug mode. Defaults to false.
	 */
	public async init(init: EngineStartupOptions): Promise<EngineCore> {
		const { engineRom, cartridge, workspaceOverlay, worldConfig, sndcontext, gainnode, debug = false, startingGamepadIndex = null, enableOnscreenGamepad = false, ecsPipeline, platform, viewHost } = init;
		if (!platform) {
			throw new Error('[Game] Platform services not provided. Pass a Platform instance in GameInitArgs.');
		}
		const resolvedViewHost = viewHost ?? platform.gameviewHost;
		if (!resolvedViewHost) {
			throw new Error('[Game] Platform did not expose a GameViewHost. Provide one in GameInitArgs.');
		}
		this._sndcontext = sndcontext;
		this._gainnode = gainnode;
		const engineLayer = await buildRuntimeAssetLayer({ blob: engineRom, id: 'system' });
		this._engine_layer = engineLayer;
		this._workspace_overlay = workspaceOverlay;
		this._assets = engineLayer.assets;
		this._asset_source = new AssetSourceStack([{ id: engineLayer.id, index: engineLayer.index, payload: engineLayer.payload }]);
		platform.gameviewHost = resolvedViewHost;
		this._platform = platform;
		setMicrotaskQueue(platform.microtasks);
		this.running = false;
		this._paused = false;
		this.wasupdated = true;
		this.setUfpsScaled(engineLayer.index.manifest.machine.ufps);
		this.recomputeTimingCaches();

		this._debug = debug ?? this._debug;
		$debug = this._debug;

		EventEmitter.instance; // Init event emitter
		Input.initialize(startingGamepadIndex); // Init input module
		if (enableOnscreenGamepad || this.input.isOnscreenGamepadEnabled) {
			this.input.enableOnscreenGamepad();
		}

		if (typeof document !== 'undefined') {
			ensureBrowserBackendFactory();
		}
		let resolvedWorldConfig = worldConfig;
		if (!resolvedWorldConfig) {
			let viewport = engineLayer.index.manifest.machine.viewport;
			if (cartridge) {
				const cartNormalized = normalizeCartridgeBlob(cartridge);
				const cartIndex = await parseCartridgeIndex(cartNormalized.payload);
				viewport = cartIndex.manifest.machine.viewport;
			}
			resolvedWorldConfig = {
				viewportSize: shallowcopy(viewport),
				modules: [createEmulatorModule()],
			};
		}
		const viewportInput = resolvedWorldConfig.viewportSize as { width?: number; height?: number; x?: number; y?: number };
		const viewportSize = { x: (viewportInput.width ?? viewportInput.x)!, y: (viewportInput.height ?? viewportInput.y)! }; // Ugly and needs to be refactored in the GameView
		const gview = new GameView({
			viewportSize,
			host: resolvedViewHost,
		});
		this._view = gview;
		const gpuBackend = await resolvedViewHost.createBackend() as GPUBackend;
		gview.backend = gpuBackend;
		new TextureManager(gpuBackend);
		const pipelineRegistry = new RenderPassLibrary(gpuBackend);
		pipelineRegistry.registerBuiltin(gpuBackend);
		gview.pipelineRegistry = pipelineRegistry;
		gview.initializePresentationPassTokens();
		gview.init();

		resolvedViewHost.onResize((dims) => {
			gview.configureRenderTargets({
				viewportScale: dims.viewportScale,
				canvasScale: dims.canvasScale,
			});
		});

		// Perform initial layout - this will call host.getSize which triggers browser layout
		const initialDims = resolvedViewHost.getSize(viewportSize, gview.canvasSize);
		gview.configureRenderTargets({
			viewportScale: initialDims.viewportScale,
			canvasScale: initialDims.canvasScale,
		});

		await gview.initializeDefaultTextures();

		if (this._sndcontext) {
			try {
				await PSG.init(this._sndcontext, GameOptions.volumePercentage, this._gainnode);
			} catch (error) {
				console.error("Failed to initialize PSG:", error);
			}
		}

		// Init the model to populate states (and do other init stuff) and
		// Init all the stuff that is game-specific. Placed here to reduce boilerplating
		if (!resolvedWorldConfig) throw new Error('World configuration not passed to game init!');
		this.initialWorldConfigSnapshot = resolvedWorldConfig;
		new World(resolvedWorldConfig);
		Input.instance.bind();
		// Register built-in ECS systems; allow modules to register extensions on boot
		registerBuiltinECS();
		// Initialize world (spaces, FSM/BT libraries, modules onBoot)
		await this.world.init_on_boot();
		// Compose pipeline spec from profile/custom and module extensions
		const baseSpec: NodeSpec[] = ecsPipeline ? shallowcopy(ecsPipeline) : gameplaySpec();
		const extensions = collectEcsPipelineExtensionsFromWorldModules({ world: this.world, registry: DefaultECSPipelineRegistry });
		for (const node of extensions) {
			baseSpec.push(shallowcopy(node));
		}
		this._pipelineSpec = baseSpec; // Note that the base spec already includes extensions, and is already a clone
		this._pipelineOverride = null;
		this.rebuildPipeline();

		// Activation: services begin play here (objects already activated in onspawn)
		this.registry.getRegisteredEntitiesByType(Service).forEach(service => service.activate());

		// Register / create physics world (MVP). Exposed via registry for components/game objects.
		new PhysicsWorld().bind();

		if (this.debug) {
			Input.instance.enableDebugMode(this.view.surface); // Do this after the world is initialized to prevent race conditions
		}
		else {
			// Prevent the user from accidentally closing the game window if not in debug mode
			this.removeWillExit = $.platform.lifecycle.onWillExit(this.onBeforeUnload);
		}
		this.initialized = true; // Mark the game as initialized
		await Runtime.init(cartridge);
		// SoundMaster.instance.volume = 0;
		return this!; // Allow chaining
	}

	private onBeforeUnload = (e: PlatformExitEvent) => {
		e.preventDefault();
		e.setReturnMessage('Are you sure you want to exit this awesome game?');
	};

	private rebuildPipeline(): void {
		if (!this.world) {
			throw new Error('[Game] Cannot rebuild pipeline before world initialization.');
		}
		if (this._pipelineSpec.length === 0 && !this._pipelineOverride) {
			throw new Error('[Game] Gameplay pipeline spec has not been initialized and no override is available.');
		}

		const base = this._pipelineOverride ?? this._pipelineSpec;
		const combinedSpec = base.map(node => shallowcopy(node));
		const nonModuleExtensions = this._pipelineExt ?? [];
		for (const node of nonModuleExtensions) {
			combinedSpec.push(shallowcopy(node));
		}
		DefaultECSPipelineRegistry.build(this.world, combinedSpec);
	}

	public get pipeline_spec() {
		return this._pipelineSpec;
	}

	public set pipeline_spec_override(spec: NodeSpec[]) {
		this._pipelineOverride = spec;
		this.rebuildPipeline();
	}

	public set pipeline_ext(spec: NodeSpec[]) {
		this._pipelineExt = spec;
		this.rebuildPipeline();
	}

	public async reset_to_fresh_world(options?: { preserve_textures?: boolean }): Promise<void> {
		if (!this.initialized) {
			throw new Error('[Game] Cannot reset world before initialization.');
		}
		const preserveTextures = options?.preserve_textures === true;
		const gateToken = renderGate.begin({ blocking: true, tag: 'world-reset' });
		const runToken = runGate.begin({ blocking: true, tag: 'world-reset' });
		try {
			this.sndmaster.resetPlaybackState();
			// if (this.psgEnabled) {
			// 	PSG.stopAll();
			// }

			if (this.world) {
				this.world.clearAllSpaces();
				this.world.dispose();
			}

			this.ae_registry.clear();
			this.event_emitter.clear();
			this.registry.clear();
			if (!preserveTextures) {
				this.texmanager.clear();
				this.view.reset();
			}

			const world = new World(this.initialWorldConfigSnapshot);
			await world.init_on_boot();

			this.rebuildPipeline();

			const services = this.registry.getRegisteredEntitiesByType(Service);
			for (const service of services) {
				service.bind();
				if (!service.active) {
					service.activate();
				}
			}

			PhysicsWorld.rebuild();
			if (!preserveTextures) {
				await this.view.initializeDefaultTextures();
			}
		}
		finally {
			this.wasupdated = true;
			renderGate.end(gateToken);
			runGate.end(runToken);
		}
	}

	/**
	 * Gets the current turn counter value.
	 * @returns The current turn counter value.
	 */
	public get turnCounter(): number {
		return this._turnCounter!;
	}

	/**
	 * Starts the game loop and sets the `running` flag to `true`.
	 * @returns void
	 */
	public start(): void {
		if (!this.initialized) {
			throw new Error('Game not initialized. Call init() before starting the game!');
		}
		const platform = this.platform;
		const now = platform.clock.now();
		this.last_update = now;
		this.last_gametick_time = now;
		this._turnCounter = 0;
		this.cycleCarry = 0;
		this.frameLoopHandle = platform.frames.start(this.run);
		this.running = true;
	}

	/**
	 * Updates the game state with the given delta time.
	 * @param deltaTime - The time elapsed since the last update.
	 * @returns void
	 */
	public update(deltaTime: number): void {
		let failed = false;
		// Step physics first so world object logic can react to post-collision resolved positions.
		try {
			$.world.run(deltaTime, false);
		} catch (error) {
			failed = true;
			// Surface engine/runtime errors to the in-game terminal when active
			const runtime = Runtime.instance;
			if (runtime) {
				try {
					runtimeIde.handleLuaError(runtime, error);
					runtime.abandonFrameState(); // ensure we abandon the frame state to prevent freezing
				} catch (error) { /* ignore secondary failures, but log them */
					console.error(`Error while handling surfaced game error in runtime: ${error?.message ?? '<unknown error>'}`);
					// ignore secondary failures, but log them
				}
				failed = true;
			}
		}

		if (!failed) { // Only store a rewind snapshot if the update succeeded to avoid corrupt states
			if (REWIND_BUFFER_ACTIVATED && ($._turnCounter % REWIND_BUFFER_WRITE_FREQUENCY === 0)) {
				// --- Rewind snapshot logic ---
				try {
					const snapshot = $.save(false);
					const compressedSnapshot = BinaryCompressor.compressBinary(snapshot, { disableLZ77: false, disableRLE: false });
					this.rewindBuffer.push(this.turnCounter, compressedSnapshot);
				} catch (e) {
					console.warn('Rewind snapshot failed:', e);
				}
			}
		}
		if ($.debug_runSingleFrameAndPause) {
			$.debug_runSingleFrameAndPause = false;
			$.paused = true;
		}
		$._turnCounter++;
	}

	private computeCycleBudget(runtime: Runtime): number {
		return calcCyclesPerFrameScaled(runtime.cpuHz, this.ufps_scaled);
	}

	/**
	 * Runs the game loop and updates the game state.
	 * @param currentTime - The current time in milliseconds`
	 * @returns void
	 */
	private run = (currentTime: number): void => {
		if (!this.running) return;

		const profile = (globalThis as any).__bmsx_profile_frames;
		const debugTickRate = Boolean((globalThis as any).__bmsx_debug_tickrate);
		if (debugTickRate) {
			if (this.debugTickReportAtMs === 0) {
				this.debugTickReportAtMs = currentTime;
			}
			this.debugTickHostFrames += 1;
		}
		const t0 = profile ? performance.now() : 0;
		let tPoll = 0;
		let tUpdate = 0;
		let tUpdateStart = 0;
		let tPresentTick = 0;
		let tDraw = 0;
		let t1 = 0;

		try {
			if (profile) t1 = performance.now();
			Input.instance.pollInput();
			if (profile) tPoll = performance.now() - t1;

				const hostDeltaMs = Math.min(currentTime - this.last_update, MAX_FRAME_DELTA);
				this.last_update = currentTime;

				if (this._paused) {
					this.wasupdated = true;
					this.deltatime = hostDeltaMs;
					this.accumulated_time = 0;
					if (profile) t1 = performance.now();
					this.world.runTickGroups(PRESENTATION_TICK_GROUPS);
					if (profile) tPresentTick = performance.now() - t1;
				if (profile) t1 = performance.now();
				this.view.drawgame();
				if (profile) tDraw = performance.now() - t1;
				if (profile) {
					const total = performance.now() - t0;
					if (total > 50) {
						console.warn(`[BMSX][frame] slow=${total.toFixed(1)}ms poll=${tPoll.toFixed(1)}ms presentTick=${tPresentTick.toFixed(1)}ms draw=${tDraw.toFixed(1)}ms paused=true`);
					}
				}
				return;
			}

				const maxAccumulated = this.timestep_ms * MAX_SUBSTEPS;
				this.accumulated_time = clamp(this.accumulated_time + hostDeltaMs, 0, maxAccumulated);
				this.wasupdated = false;
				let presentQueued = false;

				const runtime = Runtime.instance;
				let ticksStarted = 0;
				let slicesProcessed = 0;
				if (profile) tUpdateStart = performance.now();
				const baseBudget = this.computeCycleBudget(runtime);
				const runTickPresentation = () => {
					// Presentation-facing delta time should reflect host timing.
					this.deltatime = hostDeltaMs;
					if (profile) t1 = performance.now();
					this.world.runTickGroups(PRESENTATION_TICK_GROUPS, false);
					if (profile) tPresentTick += performance.now() - t1;
					presentQueued = true;
				};
				if (!runGate.ready || this.paused) {
					this.accumulated_time = 0;
				} else {
					const slicesAvailable = Math.min(Math.floor(this.accumulated_time / this.timestep_ms), MAX_SUBSTEPS);
					for (; slicesProcessed < slicesAvailable; slicesProcessed += 1) {
						if (!runGate.ready || this.paused) {
							this.accumulated_time = 0;
							break;
						}
						const tickActive = runtime.hasActiveTick();
						const carryBudget = tickActive ? 0 : this.cycleCarry;
						if (carryBudget !== 0) {
							this.cycleCarry = 0;
						}
						runtime.grantCycleBudget(baseBudget, carryBudget);
						if (tickActive) {
							runtime.tickUpdate();
						} else {
							this.deltatime = this.timestep_ms;
							this.update(this.timestep_ms);
							if (debugTickRate) {
								this.debugTickUpdates += 1;
							}
							ticksStarted += 1;
						}
						const completion = runtime.consumeLastTickCompletion();
						if (completion) {
							this.cycleCarry = completion.remaining > baseBudget ? baseBudget : completion.remaining;
							runTickPresentation();
						}
					}
					if (slicesProcessed > 0) {
						const consumed = slicesProcessed * this.timestep_ms;
						this.accumulated_time = clamp(this.accumulated_time - consumed, 0, maxAccumulated);
					}
				}
				if (presentQueued) {
					this.wasupdated = true;
					if (profile) t1 = performance.now();
					this.view.drawgame();
					if (profile) tDraw += performance.now() - t1;
				}
				if (debugTickRate) {
					const elapsedMs = currentTime - this.debugTickReportAtMs;
					if (elapsedMs >= 1000) {
						const scale = 1000 / elapsedMs;
						const updatesPerSec = this.debugTickUpdates * scale;
						const hostFramesPerSec = this.debugTickHostFrames * scale;
						const updatesPerHostFrame = this.debugTickUpdates / this.debugTickHostFrames;
						console.info(`[BMSX][tickrate] target=${this.target_fps.toFixed(3)} ufps=${this.ufps.toFixed(3)} updates=${updatesPerSec.toFixed(3)} host=${hostFramesPerSec.toFixed(3)} updates/host=${updatesPerHostFrame.toFixed(3)}`);
						this.debugTickReportAtMs = currentTime;
						this.debugTickHostFrames = 0;
						this.debugTickUpdates = 0;
					}
				}
				if (profile) tUpdate = performance.now() - tUpdateStart;

			if (this.wasupdated && profile) {
				const total = performance.now() - t0;
				if (total > 50) {
					console.warn(`[BMSX][frame] slow=${total.toFixed(1)}ms poll=${tPoll.toFixed(1)}ms update=${tUpdate.toFixed(1)}ms presentTick=${tPresentTick.toFixed(1)}ms draw=${tDraw.toFixed(1)}ms steps?`);
				}
			}
		} catch (error) {
			// Surface engine/runtime errors to the in-game terminal when active
			const runtime = Runtime.instance;
			if (runtime) {
				try {
					runtimeIde.handleLuaError(runtime, error);
					runtime.abandonFrameState();
				} catch { /* ignore secondary failures, but log them */
					console.error(`Error while handling surfaced game error in runtime: ${error}`);
					// Abort the remainder of this update to keep state coherent this frame.
					runtime.abandonFrameState(); // ensure we abandon the frame state to prevent freezing
					this.wasupdated = true; // Force a redraw to show the error state and prevent freezing the game
				}
			}
		}
	}

	/**
	 * Stops the game loop and clears the screen, stops all sound effects and music.
	 * @returns void
	 */
	public stop(): void {
		this.running = false;
		if (this.frameLoopHandle) {
			this.frameLoopHandle.stop();
			this.frameLoopHandle = null;
		}
		const platform = this.platform;
		const handle = platform.frames.start(() => {
			handle.stop();
			this.sndmaster.stopEffect();
			this.sndmaster.stopMusic();
		});
		if (this.removeWillExit) {
			this.removeWillExit.unsubscribe();
			this.removeWillExit = null;
		}
	}

	/** Serialize the full game state: world + selected services. */
	public save(compress: boolean = true): Uint8Array {
		// Assemble Savegame DTO using the same rules as World.save but orchestrated here
		const worldAny = this.world as Record<string, any>;
		const keys = Object.keys(worldAny);
		const data: Record<string, unknown> = {};
		const worldCtor: any = this.world.constructor;
		for (let i = 0; i < keys.length; ++i) {
			const k = keys[i];
			// Respect World.keys_to_exclude_from_save and dynamic excludes
			if (Serializer.excludedProperties[worldCtor.name]?.[k]) continue;
			const v = worldAny[k]; if (v !== null && v !== undefined) data[k] = v;
		}
		const sg = new Savegame();
		sg.modelprops = data;
		sg.spaces = this.world.spaces; // Spaces and their contained objects are serialized directly via references.

		sg.machineState = Runtime.instance ? runtimeLuaPipeline.captureCurrentState(Runtime.instance) : null;
		const serialized = Serializer.serialize(sg) as Uint8Array;
		return compress ? BinaryCompressor.compressBinary(serialized) : serialized;
	}

	/** Load a game save: restores world, services, and engine state. */
	public load(serialized: Uint8Array, compressed: boolean = true): void {
		const gateToken = renderGate.begin({ blocking: true, tag: 'load' });
		const runToken = runGate.begin({ blocking: true, tag: 'load' });
		try {
			const buf = compressed ? BinaryCompressor.decompressBinary(serialized) : serialized;

			// World hydration (ported from World.load)
			this.world.clearAllSpaces();
			this.world.disposeAndRemoveAllSpaces();

			// Clear event listeners
			this.event_emitter.clear();
			// Reset registries except persistent entities
			this.registry.clear();
			// Purge textures and reset view
			this.texmanager.clear();
			this.view.reset();

			const sg = Reviver.deserialize(buf) as Savegame;
			// Apply plain world props back to world
			for (const [k, v] of Object.entries(sg.modelprops as Record<string, unknown>)) {
				if (typeof v !== 'function') (this.world as { [key: string]: any })[k] = v;
			}

			// Module load hooks
			for (const p of this.world.modules ?? []) p.onLoad?.(this.world);

			// Do not override revived flags or controller state; onspawn('revive') and @onload hooks handled wiring.

			// Restore service state (opt-in)
			if (sg.machineState) {
				runtimeLuaPipeline.applyState(Runtime.instance, sg.machineState).then(() => {
					this.wasupdated = true;
					renderGate.end(gateToken);
					runGate.end(runToken);
				}).catch((e) => {
					console.error(`Error loading game state: ${e}`);
					this.wasupdated = true;
					renderGate.end(gateToken);
					runGate.end(runToken);
				});
			}
		} catch (e) {
			console.error(`Error loading game state: ${e}`);
		} finally {
			this.wasupdated = true;
			renderGate.end(gateToken);
			runGate.end(runToken);
		}
	}

	// --- Rewind API ---
	public canRewind() { return this.rewindBuffer.canRewind()!; }
	public canForward() { return this.rewindBuffer.canForward()!; }

	private loadRewindFrame(frame: RewindFrame): void {
		this.load(frame.state, true);
	}

	public rewindFrame(): boolean {
		const frame = this.rewindBuffer.rewind();
		if (frame) {
			this.loadRewindFrame(frame);
			return true;
		}
		return false;
	}

	public forwardFrame(): boolean {
		const frame = this.rewindBuffer.forward();
		if (frame) {
			this.loadRewindFrame(frame);
			return true;
		}
		return false;
	}

	public jumpToFrame(idx: number): boolean {
		const frame = this.rewindBuffer.jumpTo(idx);
		if (frame) {
			this.loadRewindFrame(frame);
			return true;
		}
		return false;
	}

	public getRewindFrames(): RewindFrame[] {
		return this.rewindBuffer.getFrames()!;
	}

	public resetRewind() {
		this.rewindBuffer.reset();
	}

	public getCurrentRewindFrameIndex(): number {
		const frames = this.rewindBuffer.getFrames();
		const idx = this.rewindBuffer.getCurrentIdx();
		if (idx === -1) return frames.length - 1;
		return frames.length - 1 - idx;
	}

	public request_shutdown(): void {
		this.platform.requestShutdown();
	}
}

export var $: EngineCore = new EngineCore()!;

// Expose legacy global `$` for scripts that expect a global symbol (e.g. bootrom/html glue)
// We intentionally write to the global scope we resolved earlier so both browser and
// node-headless runtimes have the same behaviour.
(globalScope as any).$ = $;// Global gate used to coordinate rendering. When blocked, frames are skipped.
