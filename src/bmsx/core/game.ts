import { AudioEventManager } from '../audio/audioeventmanager';
import { PSG } from "../audio/psg";
import { RandomModulationParams, SoundMaster } from "../audio/soundmaster";
import { gamePaused, gameResumed } from "../debugger/rewindui";
import { Input } from "../input/input";
import type { InputMap, VibrationParams } from "../input/inputtypes";
import { ActionState, ActionStateQuery } from '../input/inputtypes';
import { PhysicsWorld } from '../physics/physicsworld';
import { createBackendForCanvasAsync } from "../render/backend/backend_selector";
import { RenderPassLibrary } from "../render/backend/renderpasslib";
import { TextureManager } from "../render/texturemanager";
import { renderGlyphs } from "../render/glyphs";
import { color, GameView, renderGate } from "../render/gameview";
import { asset_id, Identifiable, Identifier, Registerable, RomPack, type vec3, type vec2 } from "../rompack/rompack";
import { BinaryCompressor } from "../serializer/bincompressor";
import { Reviver, Savegame, Serializer } from "../serializer/gameserializer";
import { Service } from "./service";
import { RewindBuffer, RewindFrame } from "../serializer/rewind";
import { World, WorldConfiguration } from "./world";
import { EventEmitter, EventPayload } from "./eventemitter";
import { BFont } from './font';
import { WorldObject } from "./object/worldobject";
import { GameOptions } from './gameoptions';
import { Registry } from "./registry";
import { GateGroup, taskGate } from './taskgate';
// Choose and apply an ECS pipeline here (gameplay/headless/editor)
import { DefaultECSPipelineRegistry as ECSReg } from "../ecs/pipeline";
import { registerBuiltinECS } from "../ecs/builtin_pipeline";
import type { NodeSpec } from "../ecs/pipeline";
import { gameplaySpec } from "./pipelines/gameplay";
import { collectEcsPipelineExtensions } from "../ecs/extensions";
import { dumpEcsPipeline } from "../ecs/debug";
// No direct space helpers needed here; Spaces are revived as part of the world.

global = globalThis || window; // Ensure global is defined

// Register global variables
// Note that $ is defined at the bottom of the code file
export var $rompack: RomPack;
export var $debug: boolean;

export interface GameInitArgs {
	rompack: RomPack;
	worldConfig: WorldConfiguration;
	sndcontext: AudioContext;
	gainnode: GainNode;
	debug?: boolean;
	startingGamepadIndex?: number | null;
	/**
	 * ECS pipeline selection. Provide a spec or a profile string. Defaults to 'gameplay'.
	 */
	ecsPipeline?: NodeSpec[] | 'gameplay' | 'headless' | 'editor';
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
	public targetFPS: number = GAME_FPS;
	/**
	 * The update interval for the bmsx module.
	 */
	public updateInterval: number;
	/**
	 * The timestamp of the last update.
	 */
	public lastUpdate: number = 0;
	/**
	 * The time difference between the current frame and the previous frame.
	 */
	public deltaTime: number = 0;
	/**
	 * The accumulated time in milliseconds.
	 */
	public accumulatedTime: number = 0;

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
	animationFrameRequestid!: number;
	/**
	 * Indicates whether the game is currently running.
	 */
	public running: boolean;

	/**
	 * Indicates whether the game is currently paused (by the debugger).
	 */
	private _paused: boolean;

	public get paused(): boolean { return this._paused; }
	public set paused(value: boolean) {
		if (this._paused === value) return; // No change
		this._paused = value;
		if (this._paused === true) {
			this.sndmaster.pause();
			this.view.showPauseOverlay();
			if (this.debug) {
				// Show debug information
				gamePaused();
			}
		}
		else if (this._paused === false) {
			this.view.showResumeOverlay();
			gameResumed();
			this.sndmaster.resume();
		}
	}

	/**
	 * Indicates whether the game was updated.
	 * This property is used to track if any changes were made to the game before rendering a new frame.
	 */
	wasupdated: boolean;

	/**
	 * Indicates whether the game should run a single frame and then pause for debugging purposes.
	 */
	public debug_runSingleFrameAndPause!: boolean;

	// When paused, this flag requests a single safe render frame via the main loop
	private _pausedOneShotRenderPending: boolean = false;

	/**
	 * Request one single render while the game is paused. The render is executed
	 * from the main run() loop so drawgame() is called in the normal gated path.
	 * Multiple calls within the same frame are coalesced.
	 */
	public requestPausedFrame(): void {
		if (this._paused) this._pausedOneShotRenderPending = true;
	}

	public get rompack(): RomPack { return $rompack; }

	public get world(): World { return this.registry.get<World>('world'); }

	public get view(): GameView { return this.registry.get<GameView>('view'); }

	public get aem(): AudioEventManager { return AudioEventManager.instance; }

	public get event_emitter(): EventEmitter { return EventEmitter.instance; }

	public get input(): Input { return Input.instance; }
	public get texmanager(): TextureManager { return TextureManager.instance; }
	public get registry(): Registry { return Registry.instance; }
	public get sndmaster(): SoundMaster { return this.registry.get<SoundMaster>('sm'); }

	public emit(event_name: string, emitter: Identifiable, payload?: EventPayload) {
		this.event_emitter.emit(event_name, emitter, payload);
	}

	public get<T extends Registerable>(id: Identifier): T {
		return this.registry.get<T>(id);
	}

	public getWorldObject<T extends WorldObject>(id: Identifier): T {
		return this.world.getWorldObject<T>(id);
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

	public spawn(o: WorldObject, pos?: vec3, ignoreSpawnhandler?: boolean): void {
		this.world.spawn(o, pos, ignoreSpawnhandler);
	}

	public exile(o: WorldObject): void { this.world.despawnFromAllSpaces(o); }

	public renderGlyphs(x: number, y: number, textToWrite: string | string[], z: number = 950, font?: BFont, color?: color, backgroundColor?: color): void {
		renderGlyphs(x, y, textToWrite, z, font, color, backgroundColor);
	}

	public playAudio(id: asset_id, options: RandomModulationParams = {}): void {
		// Route through AudioEventManager so policies and per-channel handling stay consistent
		this.aem.playDirect(id, options);
	}

	public stopEffect(): void {
		this.sndmaster.stopEffect();
	}

	public stopMusic(): void {
		this.sndmaster.stopMusic();
	}

	public stopUI(): void {
		this.sndmaster.stopUI();
	}

	public set volume(volume: number) {
		this.sndmaster.volume = volume;
	}

	public get volume(): number {
		return this.sndmaster.volume;
	}

	public setInputMap(playerIndex: number, map: InputMap): void {
		this.input.getPlayerInput(playerIndex).setInputMap(map);
	}

	public checkActionTriggered(playerIndex: number, action: string): boolean {
		return this.input.getPlayerInput(playerIndex).checkActionTriggered(action);
	}

	public checkActionsTriggered(playerIndex: number, ...actions: { id: string, def: string }[]): string[] {
		return this.input.getPlayerInput(playerIndex).checkActionsTriggered(...actions);
	}

	public getActionState(playerIndex: number, action: string, window?: number) {
		return this.input.getPlayerInput(playerIndex).getActionState(action, window);
	}

	public getPressedActions(playerIndex: number, query?: ActionStateQuery) {
		return this.input.getPlayerInput(playerIndex).getPressedActions(query);
	}

	public consumeAction(playerIndex: number, actionToConsume: ActionState | string) {
		this.input.getPlayerInput(playerIndex).consumeAction(actionToConsume);
	}

	public consumeActions(playerIndex: number, ...actionsToConsume: (ActionState | string)[]) {
		this.input.getPlayerInput(playerIndex).consumeActions(...actionsToConsume);
	}

	public applyVibrationEffect(playerIndex: number, effectParams: VibrationParams): void {
		if (!this.input.getPlayerInput(playerIndex).supportsVibrationEffect) return;
		this.input.getPlayerInput(playerIndex).applyVibrationEffect(effectParams);
	}

	public hideOnscreenGamepadButtons(gamepad_button_ids: string[]): void {
		this.input.hideOnscreenGamepadButtons(gamepad_button_ids);
	}

	public get viewportSize(): vec2 {
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
		const { rompack, worldConfig, sndcontext, gainnode, debug = false, startingGamepadIndex = null, ecsPipeline } = init;
		$rompack = rompack;
		this.running = false;
		this._paused = false;
		this.wasupdated = true;
		this.updateInterval = 1000 / this.targetFPS;
		this.rewindBuffer = new RewindBuffer(this.targetFPS, this.REWINDBUFFER_LENGTH_SECONDS);

		this._debug = debug ?? this._debug;
		$debug = this._debug;

		GameView.imgassets = rompack.img;
		EventEmitter.instance; // Init event emitter
		Input.initialize(startingGamepadIndex ?? undefined); // Init input module
		if (this.input.isOnscreenGamepadEnabled) {
			this.input.enableOnscreenGamepad();
		}
		const gview = new GameView(worldConfig.viewportSize);
		// Initialize rendering backend + pipeline registry/manager (no global singletons)
		// Acquire WebGL2 context and backend; in future this can branch for WebGPU
		const { backend, nativeCtx } = await createBackendForCanvasAsync(gview.canvas);
		gview.nativeCtx = nativeCtx;
		gview.backend = backend; // Set the backend for the view before initializing
		new TextureManager(backend);
		const pipelineRegistry = new RenderPassLibrary(backend);
		pipelineRegistry.registerBuiltin(gview.backend); // We first need to register the built-in passes before calling view.init
		// Store on view for graph rebuild
		gview.pipelineRegistry = pipelineRegistry; // Register the pipeline registry with the view before initializing
		gview.init(); // Init the view. Placed here to ensure that the world object is available to the view and that the Input module is initialized
		gview.initializeDefaultTextures(); // Initialize default textures for the view after the backend was set (initializing textures requires backend to be available)
		await SoundMaster.instance.init(rompack['audio'], sndcontext, GameOptions.VolumePercentage, gainnode);
		try {
			await PSG.init(sndcontext, GameOptions.VolumePercentage, gainnode);
		} catch (error) {
			console.error("Failed to initialize PSG:", error);
		}
		AudioEventManager.instance.init([rompack.audioevents], null);

		// Prevent the user from accidentally closing the game window if not in debug mode
		if (!this.debug) {
			window.addEventListener('beforeunload', this.onBeforeUnload, true);
		}

		// Init the model to populate states (and do other init stuff) and
		// Init all the stuff that is game-specific. Placed here to reduce boilerplating
		if (!worldConfig) throw new Error('World configuration not passed to game init!');
		new World(worldConfig);
		// Register built-in ECS systems; allow modules to register extensions on boot
		registerBuiltinECS();
		// Initialize world (spaces, FSM/BT libraries, modules onBoot)
		$.world.init_on_boot();
		// Compose pipeline spec from profile/custom and module extensions
		const baseSpec: NodeSpec[] = Array.isArray(ecsPipeline)
			? ecsPipeline
			: gameplaySpec();
		const extensions = collectEcsPipelineExtensions({ world: $.world, profile: (Array.isArray(ecsPipeline) ? 'custom' : (ecsPipeline ?? 'gameplay')), registry: ECSReg });
		const finalSpec = baseSpec.concat(extensions);
		const diag = ECSReg.build($.world, finalSpec);
		if (this.debug) dumpEcsPipeline(diag);


		// Wiring phase (fresh boot): bind all registered entities (services, world, objects, components)
		for (const ent of this.registry.getRegisteredEntities()) {
			const maybe = ent as { bind?: (bus: EventEmitter) => void };
			if (typeof maybe.bind === 'function') maybe.bind(this.event_emitter);
		}

		// Activation: services begin play here (objects already activated in onspawn)
		for (const ent of this.registry.getRegisteredEntities()) {
			if (ent instanceof Service) { ent.activate(); }
		}

		// Register / create physics world (MVP). Exposed via registry for components/game objects.
		new PhysicsWorld().bind();

		if (this.debug) {
			// @ts-ignore
			// window[] = world;
			// // @ts-ignore
			// window['view'] = view;
			// // @ts-ignore
			// window['$rom'] = global.$rom;
			// // @ts-ignore
			// window['$'] = global.$;
			// // @ts-ignore
			// window['registry'] = global.registry;
			// // @ts-ignore
			// window['eventEmitter'] = this.event_emitter;

			Input.instance.enableDebugMode(); // Do this after the world is initialized to prevent race conditions
		}
		this.initialized = true; // Mark the game as initialized
		return this; // Allow chaining
	}

	private onBeforeUnload = (e: BeforeUnloadEvent) => {
		e.preventDefault();
		e.returnValue = 'Are you sure you want to exit this awesome game?';
	};

	/**
	 * Gets the current turn counter value.
	 * @returns The current turn counter value.
	 */
	public get turnCounter(): number {
		return this._turnCounter;
	}

	/**
	 * Starts the game loop and sets the `running` flag to `true`.
	 * @returns void
	 */
	public start(): void {
		if (!this.initialized) {
			throw new Error('Game not initialized. Call init() before starting the game!');
		}
		this.lastUpdate = performance.now();
		this.last_gametick_time = performance.now();
		this._turnCounter = 0;
		this.animationFrameRequestid = window.requestAnimationFrame(this.run);
		this.running = true;
	}

	/**
	 * Updates the game state with the given delta time.
	 * @param deltaTime - The time elapsed since the last update.
	 * @returns void
	 */
	public update(deltaTime: number): void {
		const world = $.world;
		// Step physics first so world object logic can react to post-collision resolved positions.
		world.run(deltaTime);

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

		this.deltaTime = Math.min(currentTime - this.lastUpdate, MAX_FRAME_DELTA);
		this.lastUpdate = currentTime;

		if (this._paused) {
			this.accumulatedTime = 0; // No backlog

			if (this._pausedOneShotRenderPending) {
				this._pausedOneShotRenderPending = false;
				// drawgame takes the renderGate token itself; call it from the main loop
				this.view.drawgame();
				window.dispatchEvent(new Event('frame'));
			}

			this.animationFrameRequestid = window.requestAnimationFrame(this.run);
			return;
		}

		this.accumulatedTime += this.deltaTime;
		this.wasupdated = false;

		let steps = 0;
		while (this.accumulatedTime >= this.updateInterval && steps < MAX_SUBSTEPS) {
			if (!this.paused) {
				Input.instance.pollInput();
				if (runGate.ready) {
					this.update(this.updateInterval);
				}
				else {
					this.accumulatedTime = 0; // Reset accumulated time to avoid infinite loop
					break;
				}
			}
			this.accumulatedTime -= this.updateInterval;
			++steps;
		}

		if (this.wasupdated) {
			this.view.drawgame();
			window.dispatchEvent(new Event('frame'));
		}

		this.animationFrameRequestid = window.requestAnimationFrame(this.run);
	}

	/**
	 * Stops the game loop and clears the screen, stops all sound effects and music.
	 * @returns void
	 */
	public stop(): void {
		this.running = false;
		window.cancelAnimationFrame(this.animationFrameRequestid);
		window.requestAnimationFrame(() => {
			this.view.handleResize.call(this.view);
			this.sndmaster.stopEffect();
			this.sndmaster.stopMusic();
		});
		window.removeEventListener('beforeunload', this.onBeforeUnload, true);
	}

	/** Serialize the full game state: world + selected services. */
	public save(compress: boolean = true): Uint8Array {
		// Assemble Savegame DTO using the same rules as World.save but orchestrated here
		const worldAny = this.world as unknown as Record<string, unknown>;
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

		// Capture service state DTOs (opt-in via getState)
		const servicesState: Record<string, unknown> = {};
		for (const ent of this.registry.iterate(Service, true)) {
			const dto = ent.getState();
			if (dto !== undefined) servicesState[ent.id] = dto;
		}
		if (Object.keys(servicesState).length > 0) sg.servicesState = servicesState;

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

			// Recreate spaces; revived Space.@onload wires internal maps and world indexes.
			// sg.spaces.forEach(space => this.world.addSpace(space));

			// Wiring phase (revive): bind all registered entities; no FSM start on revived instances
			// for (const ent of this.registry.getRegisteredEntities()) { ent.bind(); }

			// Module load hooks
			for (const p of this.world.modules ?? []) p.onLoad?.(this.world);

			// Do not override revived flags or controller state; onspawn('revive') and @onload hooks handled wiring.

			// Restore service state (opt-in)
			const services = sg.servicesState ?? {};
			for (const [id, dto] of Object.entries(services)) {
				const svc = this.registry.get(id) as Service | undefined;
				svc?.setState?.(dto);
			}
		} catch (e) {
			console.error(`Error loading game state: ${e}`);
		} finally {
			this.wasupdated = true;
			renderGate.end(gateToken);
			runGate.end(runToken);
			this.requestPausedFrame();
		}
	}

	// --- Rewind API ---
	public canRewind() { return this.rewindBuffer.canRewind(); }
	public canForward() { return this.rewindBuffer.canForward(); }

	private loadRewindFrame(frame: RewindFrame): void {
		this.load(frame.state, true);
		window.dispatchEvent(new Event('frame'));
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
		return this.rewindBuffer.getFrames();
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
}

export var $: Game = new Game();
