import { renderGate, runGate } from '../../machine/ts/common/taskgate';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../machine/ts/machine/runtime/save_state/codec';
import type { CartridgeSlotMediaPair } from '../../machine/ts/machine/devices/cartridge/contracts';
import { gxGpuDisplayModeScreenWidth, gxGpuVerticalVisibleLines } from '../../machine/ts/machine/devices/gx/gpu_display';
import type { MachineModelSpec } from '../../machine/ts/spec/bmsx/model';
import { parseRomImage } from '../../machine/ts/rompack/image';
import { Input } from './input/manager';
import { RenderPassLibrary } from '../../machine/ts/render/backend/pass/library';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { VideoOutput } from '../../machine/ts/render/video_output';
import type { GPUBackend } from '../../machine/ts/render/backend/backend';

const EMPTY_CARTRIDGE_ROM = new Uint8Array(0);

export function initializeMachineRuntime(
	systemRom: Uint8Array,
	cartridgeSlots: readonly [Uint8Array | null, Uint8Array | null],
	machineModel: MachineModelSpec,
	input: Input,
): Runtime {
	const systemImage = parseRomImage(systemRom, 'system');
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
	for (let slotIndex = 0; slotIndex < cartridgeSlots.length; slotIndex += 1) {
		const bytes = cartridgeSlots[slotIndex];
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

export async function captureRuntimeSaveStateBytes(
	runtime: Runtime,
	presenter: VideoPresenter,
): Promise<Uint8Array> {
	const renderToken = renderGate.begin({ blocking: true, tag: 'save-state-capture' });
	const runToken = runGate.begin({ blocking: true, tag: 'save-state-capture' });
	try {
		await presenter.backend.captureGxGpuVramSnapshot(runtime.machine.gxGpu);
		return encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
	} finally {
		renderGate.end(renderToken);
		runGate.end(runToken);
	}
}
