import { renderGate, runGate } from '../machine/ts/common/taskgate';
import { Runtime } from '../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveStateBytes } from '../machine/ts/machine/runtime/save_state/codec';
import type { CartridgeSlotMediaPair } from '../machine/ts/machine/devices/cartridge/contracts';
import { gxGpuDisplayModeScreenWidth, gxGpuVerticalVisibleLines } from '../machine/ts/machine/devices/gx/gpu_display';
import { PSX_MACHINE_SPEC } from '../machine/ts/machine/model_registry';
import { parseRomImage } from '../machine/ts/rompack/image';
import { Input } from '../machine/ts/input/manager';
import type { GamepadInput } from '../machine/ts/input/gamepad';
import { LogLevel, type Platform } from '../machine/ts/platform/platform';
import { RenderPassLibrary } from '../machine/ts/render/backend/pass/library';
import { Font } from '../machine/ts/render/shared/bmsx_font';
import { VideoPresenter } from '../machine/ts/render/video_presenter';
import { SYS_PRINT_BUFFER_BYTES } from '../machine/ts/spec/bmsx/io';
import { HostAudioOutput } from '../hosts/common/audio_output';
import { HostOverlayMenu } from './host_overlay_menu';
import { runMachineHostFrame } from './host_frame';
import { RenderPresentationState } from './presentation_state';

const systemOutputDecoder = new TextDecoder('utf-8', { fatal: true });

const EMPTY_CARTRIDGE_ROM = new Uint8Array(0);

export interface MachineHostInitializationOptions {
	systemRom: Uint8Array;
	cartridgeSlots: [Uint8Array | null, Uint8Array | null];
	startingGamepadIndex: number;
	enableOnscreenGamepad: boolean;
	platform: Platform;
}

export class MachineHost {
	public running = false;
	public hostFps = 0;
	private pausedState = false;
	public readonly audioOutput: HostAudioOutput;
	private readonly systemOutputBytes = new Uint8Array(SYS_PRINT_BUFFER_BYTES);

	public constructor(
		public readonly runtime: Runtime,
		public readonly platform: Platform,
		public readonly presenter: VideoPresenter,
		public readonly input: Input,
	) {
		this.audioOutput = new HostAudioOutput(
			platform.audio,
			runtime.machine.audioController,
			runtime.machine.audioOutput.outputRing,
			runtime.timing.ufpsScaled,
		);
	}

	public get paused(): boolean {
		return this.pausedState;
	}

	public set paused(value: boolean) {
		if (this.pausedState === value) {
			return;
		}
		this.pausedState = value;
		this.audioOutput.mutePause(value);
	}

	public start(): void {
		this.runtime.frameLoop.currentTimeMs = this.platform.clock.now();
		this.runtime.frameScheduler.clearQueuedTime();
		this.running = true;
	}

	public stop(): void {
		this.running = false;
	}

	public async initializeGamepadHid(gamepad: GamepadInput): Promise<void> {
		const wasPaused = this.paused;
		this.paused = true;
		try {
			await gamepad.init();
		} catch (error) {
			this.platform.log(
				LogLevel.Error,
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			if (!wasPaused) {
				this.paused = false;
			}
		}
	}

	public flushSystemOutput(): void {
		const output = this.runtime.machine.systemController;
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
				this.platform.log(
					LogLevel.Info,
					systemOutputDecoder.decode(this.systemOutputBytes.subarray(lineStart, index)),
				);
				lineStart = index + 1;
			}
		}
	}

	public async captureRuntimeSaveStateBytes(): Promise<Uint8Array> {
		const renderToken = renderGate.begin({ blocking: true, tag: 'save-state-capture' });
		const runToken = runGate.begin({ blocking: true, tag: 'save-state-capture' });
		try {
			await this.presenter.backend.captureGxGpuVramSnapshot(this.runtime.machine.gxGpu);
			return captureRuntimeSaveStateBytes(this.runtime);
		} finally {
			renderGate.end(renderToken);
			runGate.end(runToken);
		}
	}

}

export async function initializeMachineHost(
	options: MachineHostInitializationOptions,
): Promise<MachineHost> {
	const input = new Input(options.platform, options.startingGamepadIndex);
	if (options.enableOnscreenGamepad) {
		input.enableOnscreenGamepad();
	}
	const systemImage = parseRomImage(options.systemRom, 'system');
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
	for (let slotIndex = 0; slotIndex < options.cartridgeSlots.length; slotIndex += 1) {
		const bytes = options.cartridgeSlots[slotIndex];
		if (!bytes) continue;
		const image = parseRomImage(bytes, 'cart');
		cartridgeMedia[slotIndex] = {
			rom: image.bytes,
			boardWord: image.header.cartridgeBoardWord,
			ramByteCount: image.header.cartridgeRamByteCount,
			present: true,
		};
	}
	const runtime = new Runtime({
		systemRomBytes: systemImage.bytes,
		cartridgeSlots: cartridgeMedia,
		machineModel: PSX_MACHINE_SPEC,
	}, input);
	const output = options.platform.videoOutput;
	const gpuOutput = runtime.machine.gxGpu.readDeviceOutput();
	const viewportWidth = gxGpuDisplayModeScreenWidth(gpuOutput.displayModeWord);
	const viewportHeight = gxGpuVerticalVisibleLines(
		gpuOutput.verticalDisplayRangeWord,
		gpuOutput.displayModeWord,
	);
	const backend = await output.createBackend();
	const presenter = new VideoPresenter(
		output,
		backend,
		viewportWidth,
		viewportHeight,
	);
	presenter.default_font = new Font();
	presenter.initialize(new RenderPassLibrary(backend, presenter));
	output.onResize((dimensions) => {
		presenter.viewportScale = dimensions.viewportScale;
		presenter.canvasScale = dimensions.canvasScale;
	});
	const dimensions = output.getSize(presenter.viewportSize, presenter.canvasSize);
	presenter.viewportScale = dimensions.viewportScale;
	presenter.canvasScale = dimensions.canvasScale;
	presenter.initializeDefaultTextures();
	const host = new MachineHost(
		runtime,
		options.platform,
		presenter,
		input,
	);
	return host;
}

export async function prepareMachineHost(
	options: MachineHostInitializationOptions,
): Promise<MachineHost> {
	const host = await initializeMachineHost(options);
	const runtime = host.runtime;
	runtime.resetForSystemBoot();
	runtime.boot();
	host.flushSystemOutput();
	host.audioOutput.bootstrap();
	return host;
}

export function startMachineHostFrames(host: MachineHost): void {
	const runtime = host.runtime;
	const presentation = new RenderPresentationState();
	const hostOverlayMenu = new HostOverlayMenu(host.presenter, runtime, host.input);
	host.start();
	host.platform.frames.start((currentTime) => {
		runMachineHostFrame(
			host,
			presentation,
			hostOverlayMenu,
			currentTime,
			runGate.ready,
		);
	});
}
