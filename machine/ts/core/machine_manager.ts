import type { RuntimeIdeState } from '../ide/runtime/state';
import type { RuntimeFaultState } from '../ide/runtime/fault_state';
import { SoundMaster } from "../audio/soundmaster";
import { Input } from "../input/manager";
import { GameView } from "../render/gameview";
import { Font } from '../render/shared/bmsx_font';
import { TextureManager } from "../render/texture_manager";
import { RenderPassLibrary } from "../render/backend/pass/library";
import { LogLevel, setMicrotaskQueue } from '../platform';
import type { GameViewHost, Platform } from '../platform';
import { PAL_REFRESH_UFPS_SCALED, PSX_MACHINE_SPEC } from '../machine/model_registry';
import { HZ_SCALE } from '../machine/runtime/timing/constants';
import { renderGate, runGate } from '../common/taskgate';
import { prepareRebootToBootRom, startPreparedRuntime } from '../ide/workbench/blua32_boot';
import { Runtime } from '../machine/runtime/runtime';
import { Memory } from '../machine/memory/memory';
import { configureRuntimeMemoryMap } from '../machine/memory/specs';
import { resolveRuntimeTiming } from '../machine/runtime/boot_timing';
import { bootActiveBlua32Media } from '../ide/runtime/lua_pipeline';
import { handleLuaError } from '../ide/workbench/runtime_errors';
import { createRuntimeSourceState, type RuntimeSourceState } from '../ide/runtime/sources';
import type { GPUBackend } from '../render/backend/backend';
import { clearOverlayFrame } from '../render/host_overlay/overlay_queue';
import { RenderPresentationState } from '../render/presentation_state';
import { runMachineHostFrame } from './host_frame';
import { captureRuntimeSaveStateBytes } from '../machine/runtime/save_state/codec';
import { gxGpuDisplayModeScreenWidth, gxGpuVerticalVisibleLines } from '../machine/devices/gx/gpu_display';
import { commitGxGpuViewSnapshot } from '../render/gx/view_snapshot';
import { SYS_PRINT_BUFFER_BYTES } from '../machine/bus/io';
import {
	buildRuntimeRomLayer,
	buildSystemRuntimeRomLayer,
	parseRomImage,
} from '../rompack/loader';
import {
	type CartridgeSlotMediaPair,
} from '../machine/devices/cartridge/contracts';
import { SYSTEM_BOOT_ENTRY_PATH, SYSTEM_MACHINE_MANIFEST } from './system';

const globalScope: any = typeof window !== 'undefined' ? window : globalThis;
global = globalScope; // Ensure global is defined
const systemOutputDecoder = new TextDecoder('utf-8', { fatal: true });
const EMPTY_CARTRIDGE_ROM = new Uint8Array(0);

export interface MachineBootOptions {
	systemRom: Uint8Array;
	cartridgeSlots: [Uint8Array | null, Uint8Array | null];
	sndcontext?: AudioContext;
	gainnode?: GainNode;
	debug?: boolean;
	autoStart?: boolean;
	startingGamepadIndex?: number;
	enableOnscreenGamepad?: boolean;
	platform: Platform;
	viewHost?: GameViewHost;
}

const DEFAULT_MASTER_VOLUME = 1;

export class MachineManager {
	private initialized = false;

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
	public host_fps = 0;
	private audioUfpsScaled = PAL_REFRESH_UFPS_SCALED;
	private readonly systemOutputBytes = new Uint8Array(SYS_PRINT_BUFFER_BYTES);

	/**
	 * The ID of the animation frame request.
	 */
	private _view!: GameView;
	private _platform!: Platform;
	private _runtime!: Runtime;
	public sourceState!: RuntimeSourceState;
	public ideState!: RuntimeIdeState;
	public faultState!: RuntimeFaultState;
	public readonly screen = new RenderPresentationState();
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

	public syncAudioTiming(): void {
		const ufpsScaled = this.runtime.timing.ufpsScaled;
		this.platform.audio.setFrameTimeSec(HZ_SCALE / ufpsScaled);
		this.sndmaster.setMixerUfpsScaled(ufpsScaled);
		this.audioUfpsScaled = ufpsScaled;
	}

	public flushSystemOutput(runtime: Runtime): void {
		const output = runtime.machine.systemController;
		const byteCount = output.hostOutputAvailableByteCount();
		if (byteCount === 0) {
			return;
		}
		for (let index = 0; index < byteCount; index += 1) {
			this.systemOutputBytes[index] = output.readHostOutputByte();
		}
		let lineStart = 0;
		for (let index = 0; index < byteCount; index += 1) {
			if (this.systemOutputBytes[index] === 10) {
				this.platform.log(LogLevel.Info, systemOutputDecoder.decode(this.systemOutputBytes.subarray(lineStart, index)));
				lineStart = index + 1;
			}
		}
	}

	public syncRuntimeAudioTiming(): void {
		if (this.runtime.timing.ufpsScaled !== this.audioUfpsScaled) {
			this.syncAudioTiming();
		}
	}

	public bootstrapStartupAudio(): void {
		if (!this.platform.audio.available) {
			return;
		}
		this.syncAudioTiming();
		this.sndmaster.bootstrapRuntimeAudio(this.runtime.timing.ufpsScaled, DEFAULT_MASTER_VOLUME);
	}

	private async buildBootPlan(
		systemRom: Uint8Array,
		cartridgeSlots: [Uint8Array | null, Uint8Array | null],
	) {
		const systemImage = parseRomImage(systemRom, 'system');
		const cartridgeImages = [
			cartridgeSlots[0] ? parseRomImage(cartridgeSlots[0], 'cart') : null,
			cartridgeSlots[1] ? parseRomImage(cartridgeSlots[1], 'cart') : null,
		] as const;
		const cartridgeMedia: CartridgeSlotMediaPair = [
			{
				rom: EMPTY_CARTRIDGE_ROM,
				boardWord: 0,
				ramByteCount: 0,
				present: false,
			},
			{
				rom: EMPTY_CARTRIDGE_ROM,
				boardWord: 0,
				ramByteCount: 0,
				present: false,
			},
		];
		for (let slotIndex = 0; slotIndex < cartridgeImages.length; slotIndex += 1) {
			const image = cartridgeImages[slotIndex];
			if (!image) continue;
			cartridgeMedia[slotIndex] = {
				rom: image.payload,
				boardWord: image.header.cartridgeBoardWord,
				ramByteCount: image.header.cartridgeRamByteCount,
				present: true,
			};
		}
		const [systemLayer, slot0Layer, slot1Layer] = await Promise.all([
			buildSystemRuntimeRomLayer({
				image: systemImage,
				machine: SYSTEM_MACHINE_MANIFEST,
				entry_path: SYSTEM_BOOT_ENTRY_PATH,
			}),
			cartridgeImages[0] ? buildRuntimeRomLayer({ image: cartridgeImages[0], id: 'cart' }) : null,
			cartridgeImages[1] ? buildRuntimeRomLayer({ image: cartridgeImages[1], id: 'cart' }) : null,
		]);
		return {
			systemLayer,
			cartridgeLayers: [slot0Layer, slot1Layer] as const,
			cartridgeMedia,
		};
	}

	public async boot(options: MachineBootOptions): Promise<Runtime> {
		const { systemRom, cartridgeSlots, debug = false, autoStart = true, startingGamepadIndex = null, enableOnscreenGamepad = false, platform, viewHost } = options;
		if (!platform) {
			throw new Error('[MachineManager] Platform services not provided.');
		}
		const resolvedViewHost = viewHost ?? platform.gameviewHost;
		if (!resolvedViewHost) {
			throw new Error('[MachineManager] Platform did not expose a GameViewHost.');
		}
		const bootPlan = await this.buildBootPlan(systemRom, cartridgeSlots);
		const { systemLayer, cartridgeLayers, cartridgeMedia } = bootPlan;
		configureRuntimeMemoryMap();
		const memory = new Memory({
			systemRom: systemLayer.payload,
			cartridgeSlots: cartridgeMedia,
		});
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

		this.sourceState = createRuntimeSourceState(
			systemLayer,
			[cartridgeLayers[0], cartridgeLayers[1]],
		);
		const timing = resolveRuntimeTiming(PSX_MACHINE_SPEC.cpuFreqHz);
		const runtime = new Runtime({
			memory,
			pcrtcRunning: timing.pcrtcRunning,
			ufpsScaled: timing.ufpsScaled,
			cpuHz: timing.cpuHz,
			cycleBudgetPerFrame: timing.cycleBudgetPerFrame,
			totalHalfLines: timing.totalHalfLines,
			activeDisplayHalfLines: timing.activeDisplayHalfLines,
			geoWorkUnitsPerSec: timing.geoWorkUnitsPerSec,
		}, Input.instance);
		this._runtime = runtime;
		const gpuOutput = runtime.machine.gxGpu.readDeviceOutput();
		const viewportSize = {
			x: gxGpuDisplayModeScreenWidth(gpuOutput.displayModeWord),
			y: gxGpuVerticalVisibleLines(gpuOutput.verticalDisplayRangeWord, gpuOutput.displayModeWord),
		};
		const gview = new GameView({
			viewportSize,
			host: resolvedViewHost,
		});
		this._view = gview;
		commitGxGpuViewSnapshot(gview, gpuOutput);
		this.syncAudioTiming();
		const gpuBackend = await resolvedViewHost.createBackend() as GPUBackend;
		gview.backend = gpuBackend;
		new TextureManager(gpuBackend);
		const pipelineRegistry = new RenderPassLibrary(gpuBackend, runtime, gview);
		gview.pipelineRegistry = pipelineRegistry;
		gview.applyPresentationPassState();
		gview.init();

		resolvedViewHost.onResize((dims) => {
			gview.viewportScale = dims.viewportScale;
			gview.canvasScale = dims.canvasScale;
		});

		// Perform initial layout - this will call host.getSize which triggers browser layout
		const initialDims = resolvedViewHost.getSize(viewportSize, gview.canvasSize);
		gview.viewportScale = initialDims.viewportScale;
		gview.canvasScale = initialDims.canvasScale;

		await gview.initializeDefaultTextures();
		this.view.default_font = new Font();
		await startPreparedRuntime(runtime);
		this.flushSystemOutput(runtime);

		if (this.debug) {
			Input.instance.enableDebugMode(this.view.surface);
		}
		this.initialized = true;
		this.bootstrapStartupAudio();
		if (autoStart) {
			this.start();
		}
		return runtime;
	}

	public async rebootToBootRom(): Promise<void> {
		const gateToken = this.ideState.luaGate.begin({ blocking: true, tag: 'reboot_bootrom' });
		try {
			await this.resetRuntime();
			const rebuildBlua32Media = await prepareRebootToBootRom(this.runtime);
			await this.refreshRenderSurfaces();
			this.bootstrapStartupAudio();
			try {
				bootActiveBlua32Media(this.runtime, rebuildBlua32Media);
			}
			catch (error) {
				handleLuaError(this.runtime, error);
				throw error;
			}
			this.flushSystemOutput(this.runtime);
		}
		finally {
			this.ideState.luaGate.end(gateToken);
		}
	}

	public async refreshRenderSurfaces(): Promise<void> {
		this.texmanager.setBackend(this.view.backend);
		await this.view.initializeDefaultTextures();
	}

	public async resetRuntime(preserveTextures = false): Promise<void> {
		if (!this.initialized) {
			throw new Error('[MachineManager] Cannot reset runtime before initialization.');
		}
		const gateToken = renderGate.begin({ blocking: true, tag: 'runtime-reset' });
		const runToken = runGate.begin({ blocking: true, tag: 'runtime-reset' });
		try {
			const runtime = this.runtime;
			this.sndmaster.resetPlaybackState();
			this.debug_runSingleFrameAndPause = false;
			clearOverlayFrame();

			runtime.frameScheduler.clearQueuedTime();
			this.screen.reset();
			runtime.frameLoop.abandonFrameState();
			const ideState = this.ideState;
			ideState.overlayDrawFrameOwner = null;
			runtime.machine.cpu.clearHaltUntilIrq();
			runtime.vblank.reset();
			ideState.overlayRenderer.abandonFrame();

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
			runMachineHostFrame(runtime, currentTime, runGate.ready);
		});
		this.running = true;
	}

	public async captureRuntimeSaveStateBytes(): Promise<Uint8Array> {
		const renderToken = renderGate.begin({ blocking: true, tag: 'save-state-capture' });
		const runToken = runGate.begin({ blocking: true, tag: 'save-state-capture' });
		try {
			await this.view.captureGxGpuVramSnapshot(this.runtime.machine.gxGpu);
			return captureRuntimeSaveStateBytes(this.runtime);
		} finally {
			renderGate.end(renderToken);
			runGate.end(runToken);
		}
	}

}

export var machineManager: MachineManager = new MachineManager()!;

// Browser and node-headless boot glue share this global machine manager handle.
(globalScope as any).machineManager = machineManager;
