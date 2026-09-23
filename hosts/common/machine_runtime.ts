import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { gxGpuDisplayModeScreenWidth, gxGpuVerticalVisibleLines } from '../../machine/ts/machine/devices/gx/gpu_display';
import type { MachineModelSpec } from '../../machine/ts/spec/bmsx/model';
import { parseSystemRomImage } from '../../machine/ts/rompack/image';
import { Input } from './input/manager';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { VideoOutput } from '../../machine/ts/render/video_output';
import type { GPUBackend } from '../../machine/ts/render/backend/backend';
import { cartridgeMediaFromImages } from './cartridge_media';

export function initializeMachineRuntime(
	systemRom: Uint8Array,
	cartridgeSlots: readonly [Uint8Array | null, Uint8Array | null],
	machineModel: MachineModelSpec,
	input: Input,
): Runtime {
	const systemImage = parseSystemRomImage(systemRom);
	const runtime = new Runtime({
		systemRomBytes: systemImage.bytes,
		cartridgeSlots: cartridgeMediaFromImages(cartridgeSlots),
		machineModel,
	}, input);
	input.setFrameDurationMs(runtime.timing.frameDurationMs);
	return runtime;
}

export function initializeMachineVideoPresenter(
	runtime: Runtime,
	output: VideoOutput,
	backend: GPUBackend,
): VideoPresenter {
	const gpuOutput = runtime.machine.gxGpu.readDeviceOutput();
	const viewportWidth = gxGpuDisplayModeScreenWidth(gpuOutput.displayModeWord);
	const viewportHeight = gxGpuVerticalVisibleLines(
		gpuOutput.verticalDisplayRangeWord,
		gpuOutput.displayModeWord,
	);
	backend.resizePresentationTarget(viewportWidth, viewportHeight);
	output.setDisplaySize(viewportWidth, viewportHeight);
	const presenter = new VideoPresenter(
		output,
		backend,
		viewportWidth,
		viewportHeight,
	);
	presenter.default_font = new Font();
	presenter.initialize(new RenderPassLibrary(backend, presenter));
	presenter.initializeDefaultTextures();
	return presenter;
}
