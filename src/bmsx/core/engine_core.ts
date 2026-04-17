import { ModulationParams, ModulationPresetResolver, RandomModulationParams, SoundMaster, SoundMasterPlayRequest } from "../audio/soundmaster";
import { Input } from "../input/input";
import type { InputMap, VibrationParams } from "../input/inputtypes";
import { ActionState, ActionStateQuery, type ButtonState } from '../input/inputtypes';
import { GameView } from "../render/gameview";
import { TextureManager } from "../render/texturemanager";
import { RenderPassLibrary } from "../render/backend/renderpasslib";
import { ensureBrowserBackendFactory } from "../render/backend/browser_backend_factory";
import type { SkyboxImageIds } from "../render/shared/render_types";
import { HZ_SCALE as PLATFORM_HZ_SCALE, setMicrotaskQueue } from '../platform';
import type { GameViewHost, Platform, PlatformExitEvent, SubscriptionHandle } from '../platform';
import { asset_id, getMachineMaxVoices, RuntimeAssets, type CartManifest, type MachineManifest, type vec2 } from "../rompack/rompack";
import { AssetSourceStack, type RawAssetSource } from '../rompack/asset_source';
import { buildSystemRuntimeAssetLayer, normalizeCartridgeBlob, parseCartridgeIndex, type RuntimeAssetLayer } from '../rompack/romloader';
import { SYSTEM_BOOT_ENTRY_PATH, SYSTEM_MACHINE_MANIFEST } from './system_machine';
import type { LuaSourceRegistry } from '../machine/program/lua_sources';
import { GateGroup, taskGate } from './taskgate';
import { Runtime } from '../machine/runtime/runtime';
import { IRQ_NEWGAME } from '../machine/bus/io';
import type { GPUBackend } from '../render/backend/pipeline_interfaces';
import { InputSource, KeyModifier } from '../input/playerinput';
import { shallowcopy } from '../common/shallowcopy';
import { clearAllQueues } from '../render/shared/render_queues';
import { clearOverlayFrame } from '../render/editor/editor_overlay_queue';
import { Table } from '../machine/cpu/cpu';
import { type StringValue } from '../machine/memory/string_pool';

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

type ActionStateTableKeys = {
	action: StringValue;
	alljustpressed: StringValue;
	allwaspressed: StringValue;
	alljustreleased: StringValue;
	guardedjustpressed: StringValue;
	repeatpressed: StringValue;
	repeatcount: StringValue;
	pressed: StringValue;
	justpressed: StringValue;
	justreleased: StringValue;
	waspressed: StringValue;
	wasreleased: StringValue;
	consumed: StringValue;
	presstime: StringValue;
	timestamp: StringValue;
	pressedAtMs: StringValue;
	releasedAtMs: StringValue;
	pressId: StringValue;
	value: StringValue;
	value2d: StringValue;
	x: StringValue;
	y: StringValue;
};

const ACTION_STATE_FLAG_PRESSED = 1 << 0;
const ACTION_STATE_FLAG_JUSTPRESSED = 1 << 1;
const ACTION_STATE_FLAG_JUSTRELEASED = 1 << 2;
const ACTION_STATE_FLAG_WASPRESSED = 1 << 3;
const ACTION_STATE_FLAG_WASRELEASED = 1 << 4;
const ACTION_STATE_FLAG_CONSUMED = 1 << 5;
const ACTION_STATE_FLAG_ALLJUSTPRESSED = 1 << 6;
const ACTION_STATE_FLAG_ALLWASPRESSED = 1 << 7;
const ACTION_STATE_FLAG_ALLJUSTRELEASED = 1 << 8;
const ACTION_STATE_FLAG_GUARDEDJUSTPRESSED = 1 << 9;
const ACTION_STATE_FLAG_REPEATPRESSED = 1 << 10;

const actionStateKeysByRuntime = new WeakMap<Runtime, ActionStateTableKeys>();

function getActionStateTableKeys(runtime: Runtime): ActionStateTableKeys {
	const cached = actionStateKeysByRuntime.get(runtime);
	if (cached) {
		return cached;
	}
	const keys: ActionStateTableKeys = {
		action: runtime.canonicalKey('action'),
		alljustpressed: runtime.canonicalKey('alljustpressed'),
		allwaspressed: runtime.canonicalKey('allwaspressed'),
		alljustreleased: runtime.canonicalKey('alljustreleased'),
		guardedjustpressed: runtime.canonicalKey('guardedjustpressed'),
		repeatpressed: runtime.canonicalKey('repeatpressed'),
		repeatcount: runtime.canonicalKey('repeatcount'),
		pressed: runtime.canonicalKey('pressed'),
		justpressed: runtime.canonicalKey('justpressed'),
		justreleased: runtime.canonicalKey('justreleased'),
		waspressed: runtime.canonicalKey('waspressed'),
		wasreleased: runtime.canonicalKey('wasreleased'),
		consumed: runtime.canonicalKey('consumed'),
		presstime: runtime.canonicalKey('presstime'),
		timestamp: runtime.canonicalKey('timestamp'),
		pressedAtMs: runtime.canonicalKey('pressedAtMs'),
		releasedAtMs: runtime.canonicalKey('releasedAtMs'),
		pressId: runtime.canonicalKey('pressId'),
		value: runtime.canonicalKey('value'),
		value2d: runtime.canonicalKey('value2d'),
		x: runtime.canonicalKey('x'),
		y: runtime.canonicalKey('y'),
	};
	actionStateKeysByRuntime.set(runtime, keys);
	return keys;
}

function packActionStateFlags(state: ActionState): number {
	let flags = 0;
	if (state.pressed) flags |= ACTION_STATE_FLAG_PRESSED;
	if (state.justpressed) flags |= ACTION_STATE_FLAG_JUSTPRESSED;
	if (state.justreleased) flags |= ACTION_STATE_FLAG_JUSTRELEASED;
	if (state.waspressed) flags |= ACTION_STATE_FLAG_WASPRESSED;
	if (state.wasreleased) flags |= ACTION_STATE_FLAG_WASRELEASED;
	if (state.consumed) flags |= ACTION_STATE_FLAG_CONSUMED;
	if (state.alljustpressed) flags |= ACTION_STATE_FLAG_ALLJUSTPRESSED;
	if (state.allwaspressed) flags |= ACTION_STATE_FLAG_ALLWASPRESSED;
	if (state.alljustreleased) flags |= ACTION_STATE_FLAG_ALLJUSTRELEASED;
	if (state.guardedjustpressed) flags |= ACTION_STATE_FLAG_GUARDEDJUSTPRESSED;
	if (state.repeatpressed) flags |= ACTION_STATE_FLAG_REPEATPRESSED;
	return flags;
}

function buildActionStateTable(runtime: Runtime, state: ActionState): Table {
	const keys = getActionStateTableKeys(runtime);
	const table = new Table(0, 18);
	table.set(keys.action, runtime.internString(state.action));
	table.set(keys.alljustpressed, state.alljustpressed);
	table.set(keys.allwaspressed, state.allwaspressed);
	table.set(keys.alljustreleased, state.alljustreleased);
	table.set(keys.guardedjustpressed, state.guardedjustpressed);
	table.set(keys.repeatpressed, state.repeatpressed);
	table.set(keys.repeatcount, state.repeatcount);
	table.set(keys.pressed, state.pressed);
	table.set(keys.justpressed, state.justpressed);
	table.set(keys.justreleased, state.justreleased);
	table.set(keys.waspressed, state.waspressed);
	table.set(keys.wasreleased, state.wasreleased);
	table.set(keys.consumed, state.consumed);
	if (state.presstime !== null) {
		table.set(keys.presstime, state.presstime);
	}
	if (state.timestamp !== null) {
		table.set(keys.timestamp, state.timestamp);
	}
	if (state.pressedAtMs !== null) {
		table.set(keys.pressedAtMs, state.pressedAtMs);
	}
	if (state.releasedAtMs !== null) {
		table.set(keys.releasedAtMs, state.releasedAtMs);
	}
	if (state.pressId !== null) {
		table.set(keys.pressId, state.pressId);
	}
	if (state.value !== null) {
		table.set(keys.value, state.value);
	}
	if (state.value2d !== null) {
		const value2d = new Table(0, 2);
		value2d.set(keys.x, state.value2d[0]);
		value2d.set(keys.y, state.value2d[1]);
		table.set(keys.value2d, value2d);
	}
	return table;
}

function buildButtonStateTable(runtime: Runtime, state: ButtonState): Table {
	const keys = getActionStateTableKeys(runtime);
	const table = new Table(0, 11);
	table.set(keys.pressed, state.pressed);
	table.set(keys.justpressed, state.justpressed);
	table.set(keys.justreleased, state.justreleased);
	table.set(keys.waspressed, state.waspressed);
	table.set(keys.wasreleased, state.wasreleased);
	table.set(keys.repeatpressed, state.repeatpressed);
	table.set(keys.repeatcount, state.repeatcount);
	table.set(keys.consumed, state.consumed);
	if (state.presstime !== null) {
		table.set(keys.presstime, state.presstime);
	}
	if (state.timestamp !== null) {
		table.set(keys.timestamp, state.timestamp);
	}
	if (state.pressedAtMs !== null) {
		table.set(keys.pressedAtMs, state.pressedAtMs);
	}
	if (state.releasedAtMs !== null) {
		table.set(keys.releasedAtMs, state.releasedAtMs);
	}
	if (state.pressId !== null) {
		table.set(keys.pressId, state.pressId);
	}
	if (state.value !== null) {
		table.set(keys.value, state.value);
	}
	if (state.value2d !== null) {
		const value2d = new Table(0, 2);
		value2d.set(keys.x, state.value2d[0]);
		value2d.set(keys.y, state.value2d[1]);
		table.set(keys.value2d, value2d);
	}
	return table;
}

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
	private _asset_source: RawAssetSource = null;
	private _lua_sources: LuaSourceRegistry = null;
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
		$.view.showPauseOverlay();
	}

	private hideDebuggerControls(): void {
		this._debuggerControlsVisible = false;
		$.view.showResumeOverlay();
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
	public get asset_source(): RawAssetSource { return this._asset_source; }
	public get lua_sources(): LuaSourceRegistry { return this._lua_sources; }
	public get engine_layer(): RuntimeAssetLayer { return this._engine_layer; }
	public get workspace_overlay(): Uint8Array { return this._workspace_overlay; }
	public get cart_project_root_path(): string { return this._cart_project_root_path; }
	public set_lua_sources(sources: LuaSourceRegistry): void {
		this._lua_sources = sources;
	}
	public set_asset_source(source: RawAssetSource): void {
		this._asset_source = source;
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
		return Runtime.hasInstance && !Runtime.instance.isEngineProgramActive();
	}

	public request_new_game(): void {
		Runtime.instance.raiseEngineIrq(IRQ_NEWGAME);
	}

	public evaluate_lua(source: string): unknown[] {
		return Runtime.instance.runConsoleChunkToNative(source);
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
					cursor = Runtime.instance.getDataAsset(segments[0]);
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
		const resources = runtime.buildAudioResourcesForSoundMaster();
		await SoundMaster.instance.init(
			resources,
			DEFAULT_MASTER_VOLUME,
			resolver,
			(id) => runtime.getAudioBytesById(id)
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
		this._asset_source = new AssetSourceStack([{ id: engineLayer.id, index: engineLayer.index, payload: engineLayer.payload }]);
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
			this.debug_runSingleFrameAndPause = false;
			clearAllQueues();
			clearOverlayFrame();

			const runtime = Runtime.instance;
			if (runtime) {
				runtime.machineScheduler.clearQueuedTime();
				runtime.screen.clearPresentation();
				runtime.abandonFrameState();
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
		runtime.machineScheduler.clearQueuedTime();
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
