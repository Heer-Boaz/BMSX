import { ModulationParams, ModulationPresetResolver, RandomModulationParams, SoundMaster, SoundMasterPlayRequest } from "../audio/soundmaster";
import { Input } from "../input/input";
import type { InputMap, VibrationParams } from "../input/inputtypes";
import { ActionState, ActionStateQuery } from '../input/inputtypes';
import { GameView } from "../render/gameview";
import { TextureManager } from "../render/texturemanager";
import { RenderPassLibrary } from "../render/backend/renderpasslib";
import { ensureBrowserBackendFactory } from "../render/backend/browser_backend_factory";
import type { SkyboxImageIds } from "../render/shared/render_types";
import { HZ_SCALE as PLATFORM_HZ_SCALE, setMicrotaskQueue } from '../platform';
import type { GameViewHost, Platform, PlatformExitEvent, SubscriptionHandle } from '../platform';
import { asset_id, getMachineMaxVoices, RuntimeAssets, type vec2 } from "../rompack/rompack";
import { tokenKeyFromId } from '../rompack/asset_tokens';
import { AssetSourceStack, type RawAssetSource } from '../rompack/asset_source';
import { buildRuntimeAssetLayer, normalizeCartridgeBlob, parseCartridgeIndex, type RuntimeAssetLayer } from '../rompack/romloader';
import type { LuaSourceRegistry } from '../emulator/lua_sources';
import { GateGroup, taskGate } from './taskgate';
import { Runtime } from '../emulator/runtime';
import { IRQ_NEWGAME } from '../emulator/io';
import * as runtimeIde from '../emulator/runtime_ide';
import type { GPUBackend } from '../render/backend/pipeline_interfaces';
import { InputSource, KeyModifier } from '../input/playerinput';
import { shallowcopy } from '../utils/shallowcopy';
import { clamp } from '../utils/clamp';
import { clearBackQueues, prepareCompletedRenderQueues, prepareOverlayRenderQueues, preparePartialRenderQueues } from '../render/shared/render_queues';

const globalScope: any = typeof window !== 'undefined' ? window : globalThis;
global = globalScope; // Ensure global is defined

// Register global variables
// Note that $ is defined at the bottom of the code file
export var $debug: boolean;

export interface EngineStartupOptions {
	engineRom: Uint8Array;
	cartridge?: Uint8Array;
	workspaceOverlay?: Uint8Array;
	sndcontext?: AudioContext;
	gainnode?: GainNode;
	debug?: boolean;
	startingGamepadIndex?: number;
	enableOnscreenGamepad?: boolean;
	platform: Platform;
	viewHost?: GameViewHost;
}

const MAX_FRAME_DELTA = 250;  // ms
const MAX_SUBSTEPS = 5;
const DEFAULT_MASTER_VOLUME = 1;

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
	public target_fps: number = 0;
	public ufps_scaled: number = 0;
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
	private cycleCarry: number = 0;

	public get timestep_ms(): number { return this.update_interval_ms; } // ms per update = 1000 / fps

	public get deltatime_seconds(): number { return this.deltatime / 1000; }

	public setUfpsScaled(ufpsScaled: number): void {
		if (!Number.isSafeInteger(ufpsScaled) || ufpsScaled <= HZ_SCALE) {
			throw new Error('[EngineCore] ufps scaled must be a safe integer greater than 1 Hz.');
		}
		this.ufps_scaled = ufpsScaled;
		this.target_fps = ufpsScaled / HZ_SCALE;
		this._platform.ufpsScaled = ufpsScaled;
		this._platform.audio.setFrameTimeSec(HZ_SCALE / this.ufps_scaled);
		this.sndmaster.setMixerFps(this.target_fps);
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
	}

	private hideDebuggerControls(): void {
		this._debuggerControlsVisible = false;
		$.view.showResumeOverlay();
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

	public get view(): GameView { return this._view; }

	public get input(): Input { return Input.instance!; }
	public get texmanager(): TextureManager { return TextureManager.instance!; }
	public get sndmaster(): SoundMaster { return SoundMaster.instance; }
	public get platform(): Platform { return this._platform!; }

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

	public get_frame_delta_ms(): number {
		return Runtime.instance.frameDeltaMs;
	}

	public is_cart_program_active(): boolean {
		return Runtime.hasInstance() && !Runtime.instance.isEngineProgramActive();
	}

	public request_new_game(): void {
		Runtime.instance.raiseEngineIrq(IRQ_NEWGAME);
	}

	public evaluate_lua(source: string): unknown[] {
		return Runtime.instance.runConsoleChunkToNative(source);
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

	/**
	 * Constructs a new instance of the BMSX class.
	 */
	constructor() {
		this.initialized = false;
	}

	private recomputeTimingCaches(): void {
		this.update_interval_ms = 1000 / this.target_fps;
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
		this.sndmaster.bootstrapRuntimeAudio(DEFAULT_MASTER_VOLUME);
		const resolver = this.buildModulationResolver(this._assets);
		const runtime = Runtime.instance;
		const resources = runtime.buildAudioResourcesForSoundMaster();
		await SoundMaster.instance.init(
			resources,
			DEFAULT_MASTER_VOLUME,
			resolver,
			(id) => runtime.getAudioBytesById(id)
		);
		const maxVoices = getMachineMaxVoices(this._assets.manifest.machine);
		if (maxVoices) {
			SoundMaster.instance.setMaxVoicesByType(maxVoices);
		}
	}

	public bootstrapStartupAudio(): void {
		this.sndmaster.bootstrapRuntimeAudio(DEFAULT_MASTER_VOLUME);
	}

	public set_skybox_imgs(ids: SkyboxImageIds): void {
		Runtime.instance.setSkyboxImages(ids);
	}

	/**
	 * Inits the game on boot.
	 * @param rom - The ROM pack containing game assets.
	 * @param model - The model object that manages the game state.
	 * @param view - The view object that manages the game display.
	 * @param debug - Whether to enable debug mode. Defaults to false.
	 */
	public async init(init: EngineStartupOptions): Promise<EngineCore> {
		const { engineRom, cartridge, workspaceOverlay, debug = false, startingGamepadIndex = null, enableOnscreenGamepad = false, platform, viewHost } = init;
		if (!platform) {
			throw new Error('[Game] Platform services not provided. Pass a Platform instance in GameInitArgs.');
		}
		const resolvedViewHost = viewHost ?? platform.gameviewHost;
		if (!resolvedViewHost) {
			throw new Error('[Game] Platform did not expose a GameViewHost. Provide one in GameInitArgs.');
		}
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

		Input.initialize(startingGamepadIndex); // Init input module
		Input.instance.bind();
		if (enableOnscreenGamepad || this.input.isOnscreenGamepadEnabled) {
			this.input.enableOnscreenGamepad();
		}

		if (typeof document !== 'undefined') {
			ensureBrowserBackendFactory();
		}
		let viewport = engineLayer.index.manifest.machine.viewport;
		if (cartridge) {
			const cartNormalized = normalizeCartridgeBlob(cartridge);
			const cartIndex = await parseCartridgeIndex(cartNormalized.payload);
			viewport = cartIndex.manifest.machine.viewport;
		}
		const viewportInput = shallowcopy(viewport) as { width?: number; height?: number; x?: number; y?: number };
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

		if (this.debug) {
			Input.instance.enableDebugMode(this.view.surface);
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

	public async resetRuntime(options?: { preserve_textures?: boolean }): Promise<void> {
		if (!this.initialized) {
			throw new Error('[EngineCore] Cannot reset runtime before initialization.');
		}
		const preserveTextures = options?.preserve_textures === true;
		const gateToken = renderGate.begin({ blocking: true, tag: 'runtime-reset' });
		const runToken = runGate.begin({ blocking: true, tag: 'runtime-reset' });
		try {
			this.sndmaster.resetPlaybackState();
			this.accumulated_time = 0;
			this.cycleCarry = 0;
			this.debug_runSingleFrameAndPause = false;
			clearBackQueues();

			const runtime = Runtime.instance;
			if (runtime) {
				runtime.abandonFrameState();
				runtime.drawFrameState = null;
				runtime.clearWaitForVblank();
				runtime.resetVblankState();
				runtime.preservedRenderQueue = [];
			}

			if (!preserveTextures) {
				this.texmanager.clear();
				this.view.reset();
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
		try {
			this.deltatime = deltaTime;
			Runtime.instance.tickUpdate();
		} catch (error) {
			const runtime = Runtime.instance;
			try {
				runtimeIde.handleLuaError(runtime, error);
				runtime.abandonFrameState();
			} catch (secondaryError) {
				console.error(`Error while handling surfaced runtime error: ${secondaryError?.message ?? '<unknown error>'}`);
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

	private runOverlayModeUpdate(runtime: Runtime): void {
		runtimeIde.tickIDE(runtime);
		runtimeIde.tickTerminalMode(runtime);
	}

	private presentFrame(runtime: Runtime, hostDeltaMs: number, mode: 'partial' | 'completed'): void {
		this.deltatime = hostDeltaMs;
		const overlayActive = runtimeIde.isOverlayActive(runtime);
		if (overlayActive) {
			clearBackQueues();
		}
		runtime.tickDraw();
		runtimeIde.tickIDEDraw(runtime);
		runtimeIde.tickTerminalModeDraw(runtime);
		this.wasupdated = true;
		this.view.configurePresentation(mode, mode === 'completed' && !overlayActive);
		if (overlayActive) {
			prepareOverlayRenderQueues();
		} else if (mode === 'completed') {
			prepareCompletedRenderQueues();
		} else {
			preparePartialRenderQueues();
		}
		if (mode === 'completed') {
			this.sndmaster.finishFrame();
		}
		this.view.drawgame();
		runtime.scheduleDeferredCartBootPreparation();
	}

	/**
	 * Runs the game loop and updates the game state.
	 * @param currentTime - The current time in milliseconds`
	 * @returns void
	 */
	private run = (currentTime: number): void => {
		if (!this.running) return;
		let hostDeltaMs = 0;

		try {
			Input.instance.pollInput();
			const runtime = Runtime.instance;
			runtimeIde.tickIdeInput(runtime);
			runtimeIde.tickTerminalInput(runtime);
			hostDeltaMs = Math.min(currentTime - this.last_update, MAX_FRAME_DELTA);
			this.last_update = currentTime;

			if (this._paused) {
				this.accumulated_time = 0;
				this.runOverlayModeUpdate(runtime);
				this.presentFrame(runtime, hostDeltaMs, 'completed');
				return;
			}

			const maxAccumulated = this.timestep_ms * MAX_SUBSTEPS;
			this.accumulated_time = clamp(this.accumulated_time + hostDeltaMs, 0, maxAccumulated);
			this.wasupdated = false;
			let presentQueued = false;

			let slicesProcessed = 0;
			const baseBudget = this.computeCycleBudget(runtime);
			const runPartialPresentation = () => {
				presentQueued = true;
				this.presentFrame(runtime, hostDeltaMs, 'partial');
			};
			const runCompletedPresentation = () => {
				presentQueued = true;
				this.presentFrame(runtime, hostDeltaMs, 'completed');
			};
			if (!runGate.ready || this.paused) {
				this.accumulated_time = 0;
			} else {
				const slicesAvailable = Math.min(Math.floor(this.accumulated_time / this.timestep_ms), MAX_SUBSTEPS);
				// Advance input edge state only when a brand-new runtime tick starts.
				// Do not read "slicesAvailable > 0" as "safe to move the input frame":
				// during heavy slowdown the runtime can be resuming the same unfinished
				// simframe across multiple host frames, and hasActiveTick() stays true.
				// If beginFrame() runs on those continuation host frames, InputStateManager
				// clears jp/jr before gameplay gets the next simulation slice, which makes
				// justpressed appear to require extremely precise timing under slowdown.
				// The invariant is:
				// one input beginFrame() per newly-started simframe, never per host frame.
				if (slicesAvailable > 0 && !runtime.hasActiveTick()) {
					Input.instance.beginFrame();
				}
				for (; slicesProcessed < slicesAvailable;) {
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
					}
					const completion = runtime.consumeLastTickCompletion();
					slicesProcessed += 1;
						if (completion) {
							// A completed tick reached its frame boundary; leftover budget after
							// wait_vblank belongs to that frame and must not spill into the next one.
							this.cycleCarry = 0;
							runCompletedPresentation();
						// Present the completed frame now; any catch-up continuation resumes on the next host frame.
						break;
						}
						if (runtimeIde.isOverlayActive(runtime)) {
							this.runOverlayModeUpdate(runtime);
							runCompletedPresentation();
							break;
						}
				}
				if (slicesProcessed > 0) {
					const consumed = slicesProcessed * this.timestep_ms;
					this.accumulated_time = clamp(this.accumulated_time - consumed, 0, maxAccumulated);
				}
			}
			if (!presentQueued && runtime.isDrawPending) {
				runPartialPresentation();
			}
			if (!presentQueued && runtimeIde.isOverlayActive(runtime)) {
				this.runOverlayModeUpdate(runtime);
				runCompletedPresentation();
			}
		} catch (error) {
			// Surface engine/runtime errors to the in-game terminal when active
			const runtime = Runtime.instance;
			if (runtime) {
				try {
					runtimeIde.handleLuaError(runtime, error);
					runtime.abandonFrameState();
					if (runtimeIde.isOverlayActive(runtime)) {
						this.runOverlayModeUpdate(runtime);
						this.presentFrame(runtime, hostDeltaMs, 'completed');
					}
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

	public request_shutdown(): void {
		this.platform.requestShutdown();
	}
}

export var $: EngineCore = new EngineCore()!;

// Expose legacy global `$` for scripts that expect a global symbol (e.g. bootrom/html glue)
// We intentionally write to the global scope we resolved earlier so both browser and
// node-headless runtimes have the same behaviour.
(globalScope as any).$ = $;// Global gate used to coordinate rendering. When blocked, frames are skipped.
