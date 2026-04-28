import { SoundMaster } from "../audio/soundmaster";
import { Input } from "../input/manager";
import { GameView } from "../render/gameview";
import { TextureManager } from "../render/texture_manager";
import { RenderPassLibrary } from "../render/backend/pass/library";
import { ensureBrowserBackendFactory } from "../render/backend/browser_factory";
import { setMicrotaskQueue } from '../platform';
import type { GameViewHost, Platform } from '../platform';
import { RomBootManager } from './rom_boot_manager';
import { renderGate, runGate } from './taskgate';
import { Runtime } from '../machine/runtime/runtime';
import type { GPUBackend } from '../render/backend/interfaces';
import { clearAllQueues } from '../render/shared/queues';
import { clearOverlayFrame } from '../render/editor/overlay_queue';
import { restoreVdpContextState } from '../render/vdp/context_state';
import { initializeVdpTextureTransfer } from '../render/vdp/texture_transfer';
import { runEngineHostFrame } from './host_frame';

const globalScope: any = typeof window !== 'undefined' ? window : globalThis;
global = globalScope; // Ensure global is defined

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

/**
 * Represents the main game loop and manages the game state.
 */
export class EngineCore {
	private initialized: boolean = false; // Indicates if the game has been initialized
	private readonly romBootManager = new RomBootManager();

	/**
	 * Indicates whether debug mode is enabled.
	 */
	public get debug(): boolean { return this._debug; }
	private _debug: boolean = false;
	/**
	 * The time difference between the current frame and the previous frame.
	 */
	public deltatime: number = 0;

	public get deltatime_seconds(): number { return this.deltatime / 1000; }

	/**
	 * The ID of the animation frame request.
	 */
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
		if (this._paused) {
			this.sndmaster.pause();
		} else {
			this.sndmaster.resume();
		}
	}

	/**
	 * Indicates whether the game should run a single frame and then pause for debugging purposes.
	 */
	public debug_runSingleFrameAndPause!: boolean;

	public get view(): GameView { return this._view; }

	public get input(): Input { return Input.instance!; }
	public get texmanager(): TextureManager { return TextureManager.instance!; }
	public get sndmaster(): SoundMaster { return SoundMaster.instance; }
	public get platform(): Platform { return this._platform!; }

	/**
	 * Constructs a new instance of the BMSX class.
	 */
	constructor() {
		this.initialized = false;
	}

	public bootstrapStartupAudio(): void {
		if (!this.platform.audio.available) {
			return;
		}
		this.sndmaster.bootstrapRuntimeAudio(DEFAULT_MASTER_VOLUME);
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
		const bootPlan = await this.romBootManager.buildBootPlan({ engineRom, cartridge });
		const { engineLayer, viewportSize } = bootPlan;
		platform.gameviewHost = resolvedViewHost;
		this._platform = platform;
		setMicrotaskQueue(platform.microtasks);
		this.running = false;
		this._paused = false;
		this._debug = debug ?? this._debug;

		Input.initialize(startingGamepadIndex); // Init input module
		Input.instance.bind();
		if (enableOnscreenGamepad || this.input.isOnscreenGamepadEnabled) {
			this.input.enableOnscreenGamepad();
		}

		if (typeof document !== 'undefined') {
			ensureBrowserBackendFactory();
		}
		const gview = new GameView({
			viewportSize,
			host: resolvedViewHost,
		});
		this._view = gview;
		const gpuBackend = await resolvedViewHost.createBackend() as GPUBackend;
		gview.backend = gpuBackend;
		const textureManager = new TextureManager(gpuBackend);
		initializeVdpTextureTransfer(textureManager, gview);
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
		this.initialized = true; // Mark the game as initialized
		await Runtime.init(engineLayer, workspaceOverlay, cartridge);
		// SoundMaster.instance.volume = 0;
		return this!; // Allow chaining
	}

	public async refreshRenderAssets(): Promise<void> {
		this.texmanager.setBackend(this.view.backend);
		initializeVdpTextureTransfer(this.texmanager, this.view);
		await this.view.initializeDefaultTextures();
		restoreVdpContextState(Runtime.instance.machine.vdp);
	}

	public async resetRuntime(preserveTextures = false): Promise<void> {
		if (!this.initialized) {
			throw new Error('[EngineCore] Cannot reset runtime before initialization.');
		}
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
				await this.refreshRenderAssets();
			}
		}
		finally {
			renderGate.end(gateToken);
			runGate.end(runToken);
		}
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
		const runtime = Runtime.instance;
		runtime.frameLoop.currentTimeMs = now;
		runtime.frameScheduler.clearQueuedTime();
		platform.frames.start((currentTime: number) => {
			runEngineHostFrame(this, runtime, currentTime, runGate.ready);
		});
		this.running = true;
	}

	public request_shutdown(): void {
		this.platform.requestShutdown();
	}
}

export var engineCore: EngineCore = new EngineCore()!;

// Expose legacy global `engineCore` for scripts that expect a global symbol (e.g. bootrom/html glue)
// We intentionally write to the global scope we resolved earlier so both browser and
// node-headless runtimes have the same behaviour.
(globalScope as any).engineCore = engineCore;
(globalScope as any).$ = engineCore;
