import { PSG } from "../audio/psg";
import { RandomModulationParams, SM } from "../audio/soundmaster";
import { gamePaused, gameResumed } from "../debugger/rewindui";
import { Input } from "../input/input";
import type { InputMap, VibrationParams } from "../input/inputtypes";
import { ActionState, ActionStateQuery } from '../input/inputtypes';
import { PhysicsWorld } from '../physics/physicsworld';
import { createBackendForCanvasAsync } from "../render/backend/backend_selector";
import { GraphicsPipelineManager } from "../render/backend/pipeline_manager";
import { PipelineRegistry } from "../render/backend/pipeline_registry";
import { TEXTMANAGER_ID, TextureManager } from "../render/texturemanager";
import { TextWriter } from "../render/textwriter";
import { color, DrawImgOptions, DrawRectOptions, GameView } from "../render/view";
import { Identifiable, Identifier, Registerable, RomPack, Size, Vector } from "../rompack/rompack";
import { BinaryCompressor } from "../serializer/bincompressor";
import { RewindBuffer, RewindFrame } from "../serializer/rewind";
import { BaseModel } from "./basemodel";
import { EventEmitter } from "./eventemitter";
import { BFont } from './font';
import { GameObject } from "./gameobject";
import { GameOptions } from './gameoptions';
import { Registry } from "./registry";
import { GateGroup, taskGate } from './taskgate';

/**
 * Declare global variables and types.
 */
declare global {
	// var $: Game;
	// var $rom: RomPack;
	// var debug: boolean;
}

global = globalThis || window; // Ensure global is defined

export var $: Game;

export interface GameInitArgs<M extends BaseModel = BaseModel, V extends GameView = GameView> {
	rom: RomPack;
	model: M;
	view: V;
	sndcontext: AudioContext;
	gainnode: GainNode;
	debug?: boolean;
	startingGamepadIndex?: number | null;
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
export class Game<M extends BaseModel = BaseModel, V extends GameView = GameView> {
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
			SM.pause();
			this.view.showPauseOverlay();
			if (this.debug) {
				// Show debug information
				gamePaused();
			}
		}
		else if (this._paused === false) {
			this.view.showResumeOverlay();
			gameResumed();
			SM.resume();
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

	public get rom(): RomPack { return global.$rom; }
	public get rompack(): RomPack { return global.$rom; }

	/**
	 * Retrieves the model instance of type T.
	 * @returns The model instance of type T.
	 * @template T - The type of the model.
	 */
	public modelAs<T extends BaseModel = BaseModel>(): T { return this.registry.get<T>('model'); }

	public get model(): M { return this.modelAs<M>(); }

	/**
	 * Retrieves the global view of type T.
	 * @returns The global view of type T.
	 */
	public viewAs<T extends GameView = GameView>(): T { return this.registry.get<T>('view'); }

	public get view(): V { return this.viewAs<V>(); }

	public get event_emitter(): EventEmitter { return this.registry.get<EventEmitter>('event_emitter'); }

	public get input(): Input { return this.registry.get<Input>('input'); }
	public get texmanager(): TextureManager { return this.registry.get<TextureManager>(TEXTMANAGER_ID); }
	public get registry(): Registry { return Registry.instance; }
	public get sndmaster(): SM { return SM; }

	public emit(event_name: string, emitter: Identifiable, ...args: any[]) {
		this.event_emitter.emit(event_name, emitter, ...args);
	}

	public get<T extends Registerable>(id: Identifier): T {
		return this.registry.get<T>(id);
	}

	public getGameObject<T extends GameObject>(id: Identifier): T {
		return this.model.getGameObject<T>(id);
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

	public spawn(o: GameObject, pos?: Vector, ignoreSpawnhandler?: boolean): void {
		this.model.spawn(o, pos, ignoreSpawnhandler);
	}

	public exile(o: GameObject): void {
		this.model.exile(o);
	}

	public drawImg(options: DrawImgOptions): void {
		this.view.drawImg(options);
	}

	public drawRectangle(options: DrawRectOptions): void {
		this.view.drawRectangle(options);
	}

	public fillRectangle(options: DrawRectOptions): void {
		this.view.fillRectangle(options);
	}

	public drawText(x: number, y: number, textToWrite: string | string[], z: number = 950, font?: BFont, color?: color, backgroundColor?: color): void {
		TextWriter.drawText(x, y, textToWrite, z, font, color, backgroundColor);
	}

	public playAudio(id: string, options: RandomModulationParams = {}): void {
		SM.play(id, options);
	}

	public stopEffect(): void {
		SM.stopEffect();
	}

	public stopMusic(): void {
		SM.stopMusic();
	}

	public set volume(volume: number) {
		SM.volume = volume;
	}

	public get volume(): number {
		return SM.volume;
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

	public getViewportSize(): Size {
		return this.view.viewportSize;
	}

	private rewindBuffer: RewindBuffer;
	private readonly REWINDBUFFER_LENGTH_SECONDS: number = 60; // Length of the rewind buffer in seconds

	/**
	 * Constructs a new instance of the BMSX class.
	 */
	constructor() {
		this.initialized = false;
		global = globalThis;
		global['$'] = this;
		window['$'] = this;
		$ = this;
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
	public async init(init: GameInitArgs<M, V>): Promise<Game> {
		const { rom, model, view, sndcontext, gainnode, debug = false, startingGamepadIndex = null } = init;
		global['$rom'] = rom;
		window['$rom'] = rom;
		this.running = false;
		this._paused = false;
		this.wasupdated = true;
		this.updateInterval = 1000 / this.targetFPS;
		this.rewindBuffer = new RewindBuffer(this.targetFPS, this.REWINDBUFFER_LENGTH_SECONDS);

		this._debug = debug ?? this._debug;

		global['debug'] = this.debug;
		global['$rom'] = rom;

		GameView.imgassets = rom.img;
		EventEmitter.instance; // Init event emitter
		Input.initialize(startingGamepadIndex ?? undefined); // Init input module
		if ($.input.isOnscreenGamepadEnabled) {
			$.input.enableOnscreenGamepad();
		}
		$.view.init(); // Init the view. Placed here to ensure that the Game object is available to the view and that the Input module is initialized
		// Initialize rendering backend + pipeline registry/manager (no global singletons)
		const activeView = this.view as any; // TODO: REMOVE CAST!!
		// Acquire WebGL2 context and backend; in future this can branch for WebGPU
		const { backend, nativeCtx } = await createBackendForCanvasAsync(activeView.canvas);
		activeView.nativeCtx = nativeCtx;
		activeView.setBackend(backend);
		activeView.initializeDefaultTextures();
		new TextureManager(backend);
		const pipelineManager = new GraphicsPipelineManager(backend); // Backend conforms to minimal subset used
		const pipelineRegistry = new PipelineRegistry(pipelineManager);
		pipelineRegistry.registerBuiltin();
		// Store on view for graph rebuild
		if (typeof activeView.setPipelineRegistry === 'function') {
			activeView.setPipelineRegistry(pipelineRegistry);
		} else {
			activeView._pipelineRegistry = pipelineRegistry; // fallback
		}
		await SM.init(rom['audio'], sndcontext, GameOptions.VolumePercentage, gainnode);
		try {
			await PSG.init(sndcontext, GameOptions.VolumePercentage, gainnode);
		} catch (error) {
			console.error("Failed to initialize PSG:", error);
		}
		// SM.volume = 0;

		if (this.debug) {
			// @ts-ignore
			window['model'] = model;
			// @ts-ignore
			window['view'] = view;
			// @ts-ignore
			window['$rom'] = global.$rom;
			// @ts-ignore
			window['$'] = global.$;
			// @ts-ignore
			window['registry'] = global.registry;
			// @ts-ignore
			window['eventEmitter'] = $.event_emitter;

			Input.instance.enableDebugMode();
		}

		// Prevent the user from accidentally closing the game window if not in debug mode
		if (!this.debug) {
			window.addEventListener('beforeunload', this.onBeforeUnload, true);
		}

		// Init the model to populate states (and do other init stuff) and
		// Init all the stuff that is game-specific. Placed here to reduce boilerplating
		model.init_on_boot(); // Init the model to populate states (and do other init stuff). Placed here to ensure that the Game object is available to the model

		// Register / create physics world (MVP). Exposed via registry for components/game objects.
		if (!this.registry.has('physics_world')) {
			this.registry.register(new PhysicsWorld());
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
		this.running = true;
		this.lastUpdate = performance.now();
		this.last_gametick_time = performance.now();
		this._turnCounter = 0;
		this.animationFrameRequestid = window.requestAnimationFrame(this.run);
	}

	/**
	 * Updates the game state with the given delta time.
	 * @param deltaTime - The time elapsed since the last update.
	 * @returns void
	 */
	public update(deltaTime: number): void {
		const game = global.$;
		const model = game.model;
		// Step physics first so game object logic can react to post-collision resolved positions.
		model.run(deltaTime);

		if (REWIND_BUFFER_ACTIVATED && (game._turnCounter % REWIND_BUFFER_WRITE_FREQUENCY === 0)) {
			// --- Rewind snapshot logic ---
			try {
				const snapshot = model.save(false);
				const compressedSnapshot = BinaryCompressor.compressBinary(snapshot, { disableLZ77: false, disableRLE: false });
				this.rewindBuffer.push(this.turnCounter, compressedSnapshot);
			} catch (e) {
				console.warn('Rewind snapshot failed:', e);
			}
		}
		if (game.debug_runSingleFrameAndPause) {
			game.debug_runSingleFrameAndPause = false;
			game.paused = true;
		}
		game._turnCounter++;
		game.wasupdated = true;
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
		global.$.running = false;
		window.cancelAnimationFrame(this.animationFrameRequestid);
		window.requestAnimationFrame(() => {
			$.view.clear.call($.view);
			$.view.handleResize.call($.view);
			SM.stopEffect();
			SM.stopMusic();
		});
		window.removeEventListener('beforeunload', this.onBeforeUnload, true);
	}

	// --- Rewind API ---
	public canRewind() { return this.rewindBuffer.canRewind(); }
	public canForward() { return this.rewindBuffer.canForward(); }

	private loadRewindFrame(frame: RewindFrame): void {
		this.model.load(frame.state, true);
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
