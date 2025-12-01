import { AudioEventManager } from '../audio/audioeventmanager';
import { PSG } from "../audio/psg";
import { ModulationParams, ModulationPresetResolver, RandomModulationParams, SoundMaster, SoundMasterPlayRequest } from "../audio/soundmaster";
import { showRewindDialog } from "../debugger/rewindui";
import { Input } from "../input/input";
import type { InputMap, VibrationParams } from "../input/inputtypes";
import { ActionState, ActionStateQuery } from '../input/inputtypes';
import { PhysicsWorld } from '../physics/physicsworld';
import { GameView, renderGate } from "../render/gameview";
import { TextureManager } from "../render/texturemanager";
import { RenderPassLibrary } from "../render/backend/renderpasslib";
import { ensureBrowserBackendFactory } from "../render/backend/browser_backend_factory";
import type { GameViewHost, Platform, PlatformExitEvent } from '../platform';
import { setMicrotaskQueue } from '../platform';
import { asset_id, Identifiable, Identifier, Registerable, RomPack, type vec3, type vec2 } from "../rompack/rompack";
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
import { collectEcsPipelineExtensions } from "../ecs/extensions";
import { gameplaySpec } from './pipelines/gameplay';
import { BmsxConsoleRuntime } from '../console/runtime';
import type { GPUBackend } from '../render/backend/pipeline_interfaces';
import { ActionEffectRegistry } from '../action_effects/effect_registry';
import { InputSource, KeyModifier } from '../input/playerinput';
// No direct space helpers needed here; Spaces are revived as part of the world.

const globalScope: any = typeof window !== 'undefined' ? window : globalThis;
global = globalScope; // Ensure global is defined

// Register global variables
// Note that $ is defined at the bottom of the code file
var $rompack: RomPack; // For internal use by get Game.rompack
export var $debug: boolean;

export interface GameInitArgs {
	rompack: RomPack;
	worldConfig: WorldConfiguration;
	sndcontext?: AudioContext;
	gainnode?: GainNode;
	debug?: boolean;
	startingGamepadIndex?: number | null;
	enableOnscreenGamepad?: boolean;
	/**
	 * ECS pipeline selection. Provide a spec or a pipeline id. Defaults to the platform's default pipeline.
	 */
	ecsPipeline?: NodeSpec[];
	platform: Platform;
	viewHost?: GameViewHost;
}

const GAME_FPS = 50;
const MAX_FRAME_DELTA = 250;  // ms
const MAX_SUBSTEPS = 5;
const REWIND_BUFFER_ACTIVATED = true;
const REWIND_BUFFER_WRITE_FREQUENCY = 1; // Frames

// Gate to block the game update/run loop (used when loading/hydrating game state)
export const runGate: GateGroup = taskGate.group('run:main');

/**
 * Represents the main game loop and manages the game state.
 */
export class Game {
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
	/**
	 * The update interval for the bmsx module.
	 */
	public update_interval!: number;
	/**
	 * The timestamp of the last update.
	 */
	public last_update: number = 0;
	/**
	 * The time difference between the current frame and the previous frame.
	 */
	public deltatime: number = 0;

	public get timestep(): number { return 1000 / this.target_fps; }

	public get deltatime_seconds(): number { return this.deltatime / 1000; }

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
	private frameLoopHandle: { stop(): void } | null = null;
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

	private removeWillExit: (() => void) | null = null;
	private _gameplayPipelineSpec: NodeSpec[] = [];
	private _pipelineOverride: NodeSpec[] | null = null;
	private initialWorldConfigSnapshot: WorldConfiguration | null = null;

	public get rompack(): RomPack { return $rompack!; }

	public get world(): World { return this.registry.get<World>('world')!; }

	public get view(): GameView { return this._view; }

	public get aem(): AudioEventManager { return AudioEventManager.instance!; }

	public get event_emitter(): EventEmitter { return EventEmitter.instance!; }

	public get input(): Input { return Input.instance!; }
	public get texmanager(): TextureManager { return TextureManager.instance!; }
	public get registry(): Registry { return Registry.instance!; }
	public get sndmaster(): SoundMaster { return this.registry.get<SoundMaster>('sm')!; }
	public get ae_registry(): ActionEffectRegistry { return ActionEffectRegistry.instance; }
	public get platform(): Platform { return this._platform!; }

	public emit(event: GameEvent): void;
	public emit(event_name: string, emitter: Identifiable | null, payload?: EventPayload): void;
	public emit(arg0: GameEvent | string, emitter?: Identifiable | null, payload?: EventPayload): void {
		if (typeof arg0 === 'string') {
			if (payload && typeof payload !== 'object') throw new Error(`[Game.emit] Payload for '${arg0}' must be an object.`);
			const event = create_gameevent({ type: arg0, emitter: emitter ?? null, ...(payload ?? {}) });
			this.emit(event);
			return;
		}
		this.event_emitter.emit(arg0);
	}

	public emit_gameplay(event: GameEvent): void;
	public emit_gameplay(event_name: string, emitter: Identifiable, payload?: EventPayload): void;
	public emit_gameplay(arg0: GameEvent | string, emitter?: Identifiable, payload?: EventPayload): void {
		let event: GameEvent;
		if (typeof arg0 === 'string') {
			if (!emitter) throw new Error(`[Game.emitGameplay] Emitter required for '${arg0}'.`);
			if (payload && typeof payload !== 'object') throw new Error(`[Game.emitGameplay] Payload for '${arg0}' must be an object.`);
			event = create_gameevent({ type: arg0, emitter, ...(payload ?? {}) });
		} else {
			event = arg0;
		}
		if (!event.emitter) throw new Error(`[Game.emitGameplay] Gameplay events require an emitter ('${event.type}').`);
		GameplayEventRecorder.instance.record(event);
		this.emit(event);
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
		// Route through AudioEventManager so policies and per-channel handling stay consistent
		this.aem.playDirect(id, options);
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

	/**
	 * Inits the game on boot.
	 * @param rom - The ROM pack containing game assets.
	 * @param model - The model object that manages the game state.
	 * @param view - The view object that manages the game display.
	 * @param sndcontext - The audio context used for playing sounds.
	 * @param gainnode - The gain node used for controlling the volume of sounds.
	 * @param debug - Whether to enable debug mode. Defaults to false.
	 */
	public async init(init: GameInitArgs): Promise<Game> {
		const { rompack, worldConfig, sndcontext, gainnode, debug = false, startingGamepadIndex = null, enableOnscreenGamepad = false, ecsPipeline, platform, viewHost } = init;
		if (!platform) {
			throw new Error('[Game] Platform services not provided. Pass a Platform instance in GameInitArgs.');
		}
		const resolvedViewHost = viewHost ?? platform.gameviewHost;
		if (!resolvedViewHost) {
			throw new Error('[Game] Platform did not expose a GameViewHost. Provide one in GameInitArgs.');
		}
		$rompack = rompack;
		platform.gameviewHost = resolvedViewHost;
		this._platform = platform;
		setMicrotaskQueue(platform.microtasks);
		this.running = false;
		this._paused = false;
		this.wasupdated = true;
		this.update_interval = 1000 / this.target_fps;
		this.rewindBuffer = new RewindBuffer(this.target_fps, this.REWINDBUFFER_LENGTH_SECONDS);

		this._debug = debug ?? this._debug;
		$debug = this._debug;

		GameView.imgassets = rompack.img;
		EventEmitter.instance; // Init event emitter
		Input.initialize(startingGamepadIndex ?? undefined); // Init input module
		if (enableOnscreenGamepad || this.input.isOnscreenGamepadEnabled) {
			this.input.enableOnscreenGamepad();
		}

		if (typeof document !== 'undefined') {
			ensureBrowserBackendFactory();
		}
		const viewportInput = worldConfig.viewportSize as { width?: number; height?: number; x?: number; y?: number };
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
		await gview.initializeDefaultTextures();

		const modulationResolver: ModulationPresetResolver = {
			resolve: (key: asset_id) => {
				const data = rompack.data;
				const segments = key.split('.');
				let cursor: unknown = data;
				for (let i = 0; i < segments.length; i++) {
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
		await SoundMaster.instance.init(rompack.audio, GameOptions.volumePercentage, modulationResolver);
		if (sndcontext) {
			try {
				await PSG.init(sndcontext, GameOptions.volumePercentage, gainnode);
			} catch (error) {
				console.error("Failed to initialize PSG:", error);
			}
		}
		AudioEventManager.instance.init(rompack.audioevents, null);

		// Init the model to populate states (and do other init stuff) and
		// Init all the stuff that is game-specific. Placed here to reduce boilerplating
		if (!worldConfig) throw new Error('World configuration not passed to game init!');
		this.initialWorldConfigSnapshot = worldConfig;
		new World(worldConfig);
		Input.instance.bind();
		// Register built-in ECS systems; allow modules to register extensions on boot
		registerBuiltinECS();
		// Initialize world (spaces, FSM/BT libraries, modules onBoot)
		await this.world.init_on_boot();
		// Compose pipeline spec from profile/custom and module extensions
		const baseSpec: NodeSpec[] = Array.isArray(ecsPipeline)
			? ecsPipeline
			: gameplaySpec();
		this._gameplayPipelineSpec = baseSpec.map(node => this.cloneNodeSpec(node));
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
		// SoundMaster.instance.volume = 0;
		return this!; // Allow chaining
	}

	private onBeforeUnload = (e: PlatformExitEvent) => {
		e.preventDefault();
		e.setReturnMessage('Are you sure you want to exit this awesome game?');
	};

	private cloneNodeSpec(node: NodeSpec): NodeSpec {
		return {
			ref: node.ref,
			group: node.group,
			priority: node.priority,
			when: node.when,
		};
	}

	private rebuildPipeline(): void {
		if (!this.world) {
			throw new Error('[Game] Cannot rebuild pipeline before world initialization.');
		}
		if (this._gameplayPipelineSpec.length === 0 && !this._pipelineOverride) {
			throw new Error('[Game] Gameplay pipeline spec has not been initialized.');
		}
		const sourceSpec = this._pipelineOverride ?? this._gameplayPipelineSpec;
		const spec: NodeSpec[] = sourceSpec.map(node => this.cloneNodeSpec(node));
		if (this._pipelineOverride === null) {
			const extensions = collectEcsPipelineExtensions({ world: this.world, registry: DefaultECSPipelineRegistry });
			for (const node of extensions) {
				spec.push(this.cloneNodeSpec(node));
			}
		}
		// const diag = DefaultECSPipelineRegistry.build(this.world, spec);
		DefaultECSPipelineRegistry.build(this.world, spec);
		// if (this.debug) {
		// 	console.log('[Game] ECS Pipeline rebuilt. Diagnostics:', diag);
		// }
	}

	public get_gameplay_pipeline_spec(): NodeSpec[] {
		const baseSpec = this._gameplayPipelineSpec.map(node => this.cloneNodeSpec(node));
		const extensions = collectEcsPipelineExtensions({ world: this.world, registry: DefaultECSPipelineRegistry });
		for (const node of extensions) {
			baseSpec.push(this.cloneNodeSpec(node));
		}
		return baseSpec;
	}

	public set_pipeline_override(spec: NodeSpec[] | null): void {
		if (spec) {
			this._pipelineOverride = spec.map(node => this.cloneNodeSpec(node));
		} else {
			this._pipelineOverride = null;
		}
		if (this.initialized) {
			this.rebuildPipeline();
		}
	}

	public async reset_to_fresh_world(): Promise<void> {
		if (!this.initialized) {
			throw new Error('[Game] Cannot reset world before initialization.');
		}
		const gateToken = renderGate.begin({ blocking: true, tag: 'world-reset' });
		const runToken = runGate.begin({ blocking: true, tag: 'world-reset' });
		try {
			if (this.world) {
				this.world.clearAllSpaces();
				this.world.dispose();
			}

			this.ae_registry.clear();
			this.event_emitter.clear();
			this.registry.clear();
			this.texmanager.clear();
			this.view.reset();

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
			await this.view.initializeDefaultTextures();
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
		this.frameLoopHandle = platform.frames.start(this.run);
		this.running = true;
	}

	/**
	 * Updates the game state with the given delta time.
	 * @param deltaTime - The time elapsed since the last update.
	 * @returns void
	 */
	public update(deltaTime: number): void {
		// Step physics first so world object logic can react to post-collision resolved positions.
		try {
			$.world.run(deltaTime);
		} catch (error) {
			// Surface engine/runtime errors to the in-game terminal when active
			const consoleRuntime = BmsxConsoleRuntime.instance;
			if (consoleRuntime) {
				try {
					consoleRuntime.handleLuaError(error);
					consoleRuntime.abandonFrameState();
				} catch { /* ignore secondary failures, but log them */
					console.error(`Error while handling surfaced game error in console runtime: ${error}`);
				}
			}
			// Abort the remainder of this update to keep state coherent this frame.
			return;
		}

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
		if ($.debug_runSingleFrameAndPause) {
			$.debug_runSingleFrameAndPause = false;
			$.paused = true;
		}
		$._turnCounter++;
		$.wasupdated = true;
	}

	/**
	 * Runs the game loop and updates the game state.
	 * @param currentTime - The current time in milliseconds`
	 * @returns void
	 */
	private run = (currentTime: number): void => {
		if (!this.running) return;

		Input.instance.pollInput();

		this.deltatime = Math.min(currentTime - this.last_update, MAX_FRAME_DELTA);
		this.last_update = currentTime;

		if (this._paused) {
			this.accumulated_time = 0;
			this.world.runTickGroups([TickGroup.Presentation, TickGroup.EventFlush]);
			this.view.drawgame();
			return;
		}

		this.accumulated_time += this.deltatime;
		this.wasupdated = false;

		let steps = 0;
		while (this.accumulated_time >= this.update_interval && steps < MAX_SUBSTEPS) {
			if (!this.paused) {
				if (runGate.ready) {
					this.update(this.update_interval);
				} else {
					this.accumulated_time = 0;
					break;
				}
			}
			this.accumulated_time -= this.update_interval;
			++steps;
		}

		if (this.wasupdated) {
			this.view.drawgame();
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
			this.view.handleResize();
			this.sndmaster.stopEffect();
			this.sndmaster.stopMusic();
		});
		if (this.removeWillExit) {
			this.removeWillExit();
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

		sg.bmsxConsoleState = BmsxConsoleRuntime.instance?.state;
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
			if (sg.bmsxConsoleState) {
				BmsxConsoleRuntime.instance.state = sg.bmsxConsoleState;
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

export var $: Game = new Game()!;

// Expose legacy global `$` for scripts that expect a global symbol (e.g. bootrom/html glue)
// We intentionally write to the global scope we resolved earlier so both browser and
// node-headless runtimes have the same behaviour.
(globalScope as any).$ = $;
