import { ModulationParams, ModulationPresetResolver, RandomModulationParams, SoundMaster } from "../audio/soundmaster";
import { Input } from "../input/manager";
import type { InputMap, VibrationParams } from "../input/models";
import type { ActionStateQuery } from '../input/models';
import { GameView } from "../render/gameview";
import { TextureManager } from "../render/texture_manager";
import { RenderPassLibrary } from "../render/backend/pass_library";
import { ensureBrowserBackendFactory } from "../render/backend/browser_factory";
import type { SkyboxImageIds } from "../render/shared/submissions";
import { HZ_SCALE as PLATFORM_HZ_SCALE, setMicrotaskQueue } from '../platform';
import type { GameViewHost, Platform, PlatformExitEvent, SubscriptionHandle } from '../platform';
import { asset_id, getMachineMaxVoices, RuntimeAssets, type CartManifest, type MachineManifest, type vec2 } from "../rompack/format";
import { AssetSourceStack, type RawAssetSource } from '../rompack/source';
import { buildSystemRuntimeAssetLayer, normalizeCartridgeBlob, parseCartridgeIndex, type RuntimeAssetLayer } from '../rompack/loader';
import { SYSTEM_BOOT_ENTRY_PATH, SYSTEM_MACHINE_MANIFEST } from './system';
import type { LuaSourceRegistry } from '../machine/program/sources';
import { GateGroup, taskGate } from './taskgate';
import { Runtime } from '../machine/runtime/runtime';
import { raiseEngineIrq } from '../machine/runtime/engine_irq';
import { installNativeGlobal, runConsoleChunkToNative } from '../machine/program/executor';
import { IRQ_NEWGAME } from '../machine/bus/io';
import type { GPUBackend } from '../render/backend/interfaces';
import { InputSource, KeyModifier } from '../input/player';
import { shallowcopy } from '../common/shallowcopy';
import { clearAllQueues } from '../render/shared/queues';
import { clearOverlayFrame } from '../render/editor/overlay_queue';
import type { Table } from '../machine/cpu/cpu';
import { buildActionStateTable, buildButtonStateTable, packActionStateFlags } from '../machine/firmware/input_state_tables';

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

const DEFAULT_MASTER_VOLUME = 1;

export const HZ_SCALE = PLATFORM_HZ_SCALE;

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
	 * The time difference between the current frame and the previous frame.
	 */
	public deltatime: number = 0;

	public get deltatime_seconds(): number { return this.deltatime / 1000; }

	private _assets: RuntimeAssets = null;
	private _system_assets: RuntimeAssets = null;
	private _cart_manifest: CartManifest = null;
	private _machine_manifest: MachineManifest = null;
	private _source: RawAssetSource = null;
	private _sources: LuaSourceRegistry = null;
	private _engine_layer: RuntimeAssetLayer = null;
	private _workspace_overlay: Uint8Array = null;
	private _cart_project_root_path: string = null;

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
		$.view.showFadingOverlay('⏸️');
	}

	private hideDebuggerControls(): void {
		this._debuggerControlsVisible = false;
		$.view.hideFadingOverlay();
	}

	/**
	 * Indicates whether the game should run a single frame and then pause for debugging purposes.
	 */
	public debug_runSingleFrameAndPause!: boolean;

	private removeWillExit: SubscriptionHandle = null;

	public get assets(): RuntimeAssets { return this._assets; }
	public get system_assets(): RuntimeAssets { return this._system_assets; }
	public get cart_manifest(): CartManifest { return this._cart_manifest; }
	public get machine_manifest(): MachineManifest { return this._machine_manifest; }
	public get source(): RawAssetSource { return this._source; }
	public get sources(): LuaSourceRegistry { return this._sources; }
	public get engine_layer(): RuntimeAssetLayer { return this._engine_layer; }
	public get workspace_overlay(): Uint8Array { return this._workspace_overlay; }
	public get cart_project_root_path(): string { return this._cart_project_root_path; }
	public set_sources(sources: LuaSourceRegistry): void {
		this._sources = sources;
	}
	public set_source(source: RawAssetSource): void {
		this._source = source;
	}
	public set_assets(assets: RuntimeAssets): void {
		this._assets = assets;
	}
	public set_cart_manifest(manifest: CartManifest): void {
		this._cart_manifest = manifest;
	}
	public set_machine_manifest(manifest: MachineManifest): void {
		this._machine_manifest = manifest;
	}
	public set_cart_project_root_path(path: string): void {
		this._cart_project_root_path = path;
	}

	public get view(): GameView { return this._view; }

	public get input(): Input { return Input.instance!; }
	public get texmanager(): TextureManager { return TextureManager.instance!; }
	public get sndmaster(): SoundMaster { return SoundMaster.instance; }
	public get platform(): Platform { return this._platform!; }

	public set_inputmap(playerIndex: number, map: InputMap): void {
		this.input.getPlayerInput(playerIndex).setInputMap(map);
	}

	public action_triggered(playerIndex: number, action: string): boolean {
		return this.input.getPlayerInput(playerIndex).checkActionTriggered(action);
	}

	public actions_triggered(playerIndex: number, ...actions: { id: string, def: string }[]): string[] {
		return this.input.getPlayerInput(playerIndex).checkActionsTriggered(...actions);
	}

	public get_action_state(playerIndex: number, action: string, window?: number): number {
		return packActionStateFlags(this.input.getPlayerInput(playerIndex).getActionState(action, window));
	}

	public get_key_state(playerIndex: number, keyCode: string, modifiers: KeyModifier): Table {
		return buildButtonStateTable(Runtime.instance, this.input.getPlayerInput(playerIndex).getKeyState(keyCode, modifiers));
	}

	/** @deprecated Use {@link action_triggered} / {@link actions_triggered} with ActionParser definitions instead. */
	public get_pressed_actions(playerIndex: number, query?: ActionStateQuery): Table[] {
		const runtime = Runtime.instance;
		return this.input.getPlayerInput(playerIndex).getPressedActions(query).map(state => buildActionStateTable(runtime, state));
	}

	public consume_action(playerIndex: number, actionToConsume: string) {
		this.input.getPlayerInput(playerIndex).consumeAction(actionToConsume);
	}

	public consume_actions(playerIndex: number, ...actionsToConsume: string[]) {
		this.input.getPlayerInput(playerIndex).consumeActions(...actionsToConsume);
	}

	public get_frame_delta_ms(): number {
		return Runtime.instance.frameLoop.frameDeltaMs;
	}

	public is_cart_program_active(): boolean {
		return Runtime.hasInstance && $.sources !== Runtime.instance.engineLuaSources;
	}

	public request_new_game(): void {
		raiseEngineIrq(Runtime.instance, IRQ_NEWGAME);
	}

	public evaluate_lua(source: string): unknown[] {
		return runConsoleChunkToNative(Runtime.instance, source);
	}

	public install_native_global(name: string, value: unknown): void {
		installNativeGlobal(Runtime.instance, name, value);
	}

	public consume_button(playerIndex: number, buttonCode: string, source: InputSource) {
		this.input.getPlayerInput(playerIndex).consumeRawButton(buttonCode, source);
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

	private buildModulationResolver(): ModulationPresetResolver {
		return {
			resolve: (key: asset_id) => {
				const segments = key.split('.');
				if (segments.length === 0) {
					return undefined;
				}
					let cursor: unknown;
					if (Runtime.hasInstance) {
						cursor = Runtime.instance.assets.getDataAsset(segments[0]);
				} else {
					cursor = this._assets.data[segments[0]];
				}
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
		if (!this.platform.audio.available) {
			return;
		}
			this.sndmaster.bootstrapRuntimeAudio(DEFAULT_MASTER_VOLUME);
			const resolver = this.buildModulationResolver();
			const runtime = Runtime.instance;
			const resources = runtime.assets.buildAudioResourcesForSoundMaster(runtime.machine.memory);
			await SoundMaster.instance.init(
				resources,
				DEFAULT_MASTER_VOLUME,
				resolver,
				(id) => runtime.assets.getAudioBytesById(runtime.machine.memory, id)
			);
		SoundMaster.instance.setMaxVoicesByType(getMachineMaxVoices(this._machine_manifest));
	}

	public bootstrapStartupAudio(): void {
		if (!this.platform.audio.available) {
			return;
		}
		this.sndmaster.bootstrapRuntimeAudio(DEFAULT_MASTER_VOLUME);
	}

	public set_skybox_imgs(ids: SkyboxImageIds): void {
		Runtime.instance.machine.vdp.setSkyboxImages(ids);
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
		const engineLayer = await buildSystemRuntimeAssetLayer({
			blob: engineRom,
			machine: SYSTEM_MACHINE_MANIFEST,
			entry_path: SYSTEM_BOOT_ENTRY_PATH,
		});
		this._engine_layer = engineLayer;
		this._workspace_overlay = workspaceOverlay;
		this._system_assets = engineLayer.assets;
		this._assets = this._system_assets;
		this._cart_manifest = null;
		this._machine_manifest = engineLayer.index.machine;
		this._cart_project_root_path = null;
		this._source = new AssetSourceStack([{ id: engineLayer.id, index: engineLayer.index, payload: engineLayer.payload }]);
		platform.gameviewHost = resolvedViewHost;
		this._platform = platform;
		setMicrotaskQueue(platform.microtasks);
		this.running = false;
		this._paused = false;
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
		let viewport = engineLayer.index.machine.render_size;
		if (cartridge) {
			const cartNormalized = normalizeCartridgeBlob(cartridge);
			const cartIndex = await parseCartridgeIndex(cartNormalized.payload);
			viewport = cartIndex.machine.render_size;
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
		gview.applyPresentationPassState();
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
			this.debug_runSingleFrameAndPause = false;
			clearAllQueues();
			clearOverlayFrame();

			const runtime = Runtime.instance;
			if (runtime) {
				runtime.frameScheduler.clearQueuedTime();
				runtime.screen.clearPresentation();
				runtime.frameLoop.abandonFrameState(runtime);
				runtime.frameLoop.drawFrameState = null;
				runtime.vblank.clearHaltUntilIrq(runtime);
				runtime.vblank.reset(runtime);
				runtime.overlayRenderer.abandonFrame();
			}

			if (!preserveTextures) {
				this.texmanager.clear();
				this.view.reset();
				await this.view.initializeDefaultTextures();
			}
		}
		finally {
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
		this._turnCounter = 0;
		const runtime = Runtime.instance;
		runtime.frameLoop.currentTimeMs = now;
		runtime.frameScheduler.clearQueuedTime();
		this.frameLoopHandle = platform.frames.start((currentTime: number) => {
			runtime.frameLoop.runHostFrame(runtime, currentTime, runGate.ready);
		});
		this.running = true;
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
