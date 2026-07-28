import {
	machineManager,
	type MachineInitializationOptions,
} from '../machine/ts/core/machine_manager';
import { renderGate, runGate } from '../machine/ts/common/taskgate';
import type { Runtime } from '../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveStateBytes } from '../machine/ts/machine/runtime/save_state/codec';
import { gxGpuDisplayModeScreenWidth, gxGpuVerticalVisibleLines } from '../machine/ts/machine/devices/gx/gpu_display';
import { Input } from '../machine/ts/input/manager';
import type { Platform } from '../machine/ts/platform/platform';
import { RenderPassLibrary } from '../machine/ts/render/backend/pass/library';
import { Font } from '../machine/ts/render/shared/bmsx_font';
import { VideoPresenter } from '../machine/ts/render/video_presenter';
import { HostOverlayMenu } from './host_overlay_menu';
import { runMachineHostFrame } from './host_frame';
import { RenderPresentationState } from './presentation_state';

export interface MachineHostInitializationOptions extends MachineInitializationOptions {
	startingGamepadIndex: number;
	enableOnscreenGamepad: boolean;
}

export class MachineHost {
	public constructor(
		public readonly runtime: Runtime,
		public readonly platform: Platform,
		public readonly presenter: VideoPresenter,
	) {
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
	const input = Input.initialize(options.platform, options.startingGamepadIndex);
	if (options.enableOnscreenGamepad) {
		input.enableOnscreenGamepad();
	}
	const runtime = machineManager.initialize(options);
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
	return new MachineHost(runtime, options.platform, presenter);
}

export async function prepareMachineHost(
	options: MachineHostInitializationOptions,
): Promise<MachineHost> {
	const host = await initializeMachineHost(options);
	const runtime = host.runtime;
	runtime.resetForSystemBoot();
	runtime.boot();
	machineManager.flushSystemOutput(runtime);
	machineManager.bootstrapStartupAudio();
	return host;
}

export function startMachineHostFrames(host: MachineHost): void {
	const runtime = host.runtime;
	const presentation = new RenderPresentationState();
	const hostOverlayMenu = new HostOverlayMenu(host.presenter);
	machineManager.start();
	host.platform.frames.start((currentTime) => {
		runMachineHostFrame(
			host.presenter,
			presentation,
			hostOverlayMenu,
			runtime,
			currentTime,
			runGate.ready,
		);
	});
}
