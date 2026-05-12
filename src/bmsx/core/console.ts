import { SoundMaster } from "../audio/soundmaster";
import { Input } from "../input/manager";
import { GameView } from "../render/gameview";
import { TextureManager } from "../render/texture_manager";
import { RenderPassLibrary } from "../render/backend/pass/library";
import { ensureBrowserBackendFactory } from "../render/backend/browser_factory";
import { setMicrotaskQueue } from '../platform';
import type { GameViewHost, Platform } from '../platform';
import { DEFAULT_UFPS } from '../machine/runtime/timing/constants';
import { RomBootManager } from './rom_boot_manager';
import { renderGate, runGate } from './taskgate';
import { Runtime } from '../machine/runtime/runtime';
import type { GPUBackend } from '../render/backend/backend';
import { clearOverlayFrame } from '../render/host_overlay/overlay_queue';
import { restoreVdpContextState } from '../render/vdp/context_state';
import { VdpFrameBufferTextures } from '../render/vdp/framebuffer';
import { VdpSlotTextures } from '../render/vdp/slot_textures';
import { runConsoleHostFrame } from './host_frame';

const globalScope: any = typeof window !== 'undefined' ? window : globalThis;
global = globalScope; // Ensure global is defined

export interface ConsoleStartupOptions {
	systemRom: Uint8Array;
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

export class ConsoleCore {
	private initialized = false;
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

	public host_show_fps = false;
	public host_fps = DEFAULT_UFPS;

	/**
	 * The ID of the animation frame request.
	 */
	private _view!: GameView;
	private _platform!: Platform;
	private _runtime!: Runtime;
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
	public get runtime(): Runtime { return this._runtime; }

	constructor() {
		this.initialized = false;
	}

	public bootstrapStartupAudio(): void {
		if (!this.platform.audio.available) {
			return;
		}
		this.sndmaster.bootstrapRuntimeAudio(this.runtime.timing.ufpsScaled, DEFAULT_MASTER_VOLUME);
	}

	public async init(init: ConsoleStartupOptions): Promise<Runtime> {
		const { systemRom, cartridge, workspaceOverlay, debug = false, startingGamepadIndex = null, enableOnscreenGamepad = false, platform, viewHost } = init;
		if (!platform) {
			throw new Error('[ConsoleCore] Platform services not provided.');
		}
		const resolvedViewHost = viewHost ?? platform.gameviewHost;
		if (!resolvedViewHost) {
			throw new Error('[ConsoleCore] Platform did not expose a GameViewHost.');
		}
		const bootPlan = await this.romBootManager.buildBootPlan({ systemRom, cartridge });
		const { systemLayer, viewportSize } = bootPlan;
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
		const runtime = await Runtime.init(systemLayer, workspaceOverlay, cartridge);
		this._runtime = runtime;
		const gview = new GameView({
			viewportSize,
			host: resolvedViewHost,
		});
		this._view = gview;
		const gpuBackend = await resolvedViewHost.createBackend() as GPUBackend;
		gview.backend = gpuBackend;
		const textureManager = new TextureManager(gpuBackend);
		gview.vdpFrameBufferTextures = new VdpFrameBufferTextures(textureManager, gview);
		gview.vdpSlotTextures = new VdpSlotTextures(textureManager, gview);
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
		await runtime.startPreparedRuntime();

		if (this.debug) {
			Input.instance.enableDebugMode(this.view.surface);
		}
		this.initialized = true; // Mark the game as initialized
		this.bootstrapStartupAudio();
		this.start();
		// SoundMaster.instance.volume = 0;
		return runtime;
	}

	public async refreshRenderSurfaces(): Promise<void> {
		this.texmanager.setBackend(this.view.backend);
		await this.view.initializeDefaultTextures();
		restoreVdpContextState(this.runtime.machine.vdp, this.view);
	}

	public async resetRuntime(preserveTextures = false): Promise<void> {
		if (!this.initialized) {
			throw new Error('[ConsoleCore] Cannot reset runtime before initialization.');
		}
		const gateToken = renderGate.begin({ blocking: true, tag: 'runtime-reset' });
		const runToken = runGate.begin({ blocking: true, tag: 'runtime-reset' });
		try {
			const runtime = this.runtime;
			this.sndmaster.resetPlaybackState();
			this.debug_runSingleFrameAndPause = false;
			runtime.machine.vdp.initializeRegisters();
			clearOverlayFrame();

			runtime.frameScheduler.clearQueuedTime();
			runtime.screen.clearPresentation();
			runtime.frameLoop.abandonFrameState();
			runtime.frameLoop.drawFrameState = null;
				runtime.machine.cpu.clearHaltUntilIrq();
			runtime.vblank.reset();
			runtime.overlayRenderer.abandonFrame();

			if (!preserveTextures) {
				this.texmanager.clear();
				await this.refreshRenderSurfaces();
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
		const runtime = this.runtime;
		runtime.frameLoop.currentTimeMs = now;
		runtime.frameScheduler.clearQueuedTime();
		platform.frames.start((currentTime: number) => {
			runConsoleHostFrame(runtime, currentTime, runGate.ready);
		});
		this.running = true;
	}

}

export var consoleCore: ConsoleCore = new ConsoleCore()!;

// Browser and node-headless boot glue share this global console handle.
(globalScope as any).consoleCore = consoleCore;
(globalScope as any).$ = consoleCore;
