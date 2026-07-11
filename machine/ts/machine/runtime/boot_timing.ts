import type { Runtime } from './runtime';
import { calcCyclesPerFrameScaled, resolveVblankCycles } from './timing';
import { setFrameTiming, setTransferRates } from './timing/config';
import { getPsxGpuDisplayModeTimingForWord, PSX_MACHINE_SPEC, PSX_GPU_DISPLAY_SIZE_SPEC } from '../model_registry';

export type ResolvedRuntimeTiming = {
	viewportWidth: number;
	viewportHeight: number;
	gpuDisplayModeWord: number;
	ufpsScaled: number;
	totalScanlines: number;
	cpuHz: number;
	dmaBytesPerSec: number;
	geoWorkUnitsPerSec: number;
	cycleBudgetPerFrame: number;
	vblankCycles: number;
};

export function resolveRuntimeTiming(
	cpuHz: number,
	gpuDisplayModeWord: number,
): ResolvedRuntimeTiming {
	const renderSize = PSX_GPU_DISPLAY_SIZE_SPEC;
	const displayModeTiming = getPsxGpuDisplayModeTimingForWord(gpuDisplayModeWord);
	const refreshUfpsScaled = displayModeTiming.refreshUfpsScaled;
	return {
		viewportWidth: renderSize.renderWidth,
		viewportHeight: renderSize.renderHeight,
		gpuDisplayModeWord,
		ufpsScaled: refreshUfpsScaled,
		totalScanlines: displayModeTiming.totalScanlines,
		cpuHz,
		dmaBytesPerSec: PSX_MACHINE_SPEC.dmaBytesPerSec,
		geoWorkUnitsPerSec: PSX_MACHINE_SPEC.geoWorkUnitsPerSec,
		cycleBudgetPerFrame: calcCyclesPerFrameScaled(cpuHz, refreshUfpsScaled),
		vblankCycles: resolveVblankCycles(cpuHz, refreshUfpsScaled, displayModeTiming.totalScanlines, renderSize.renderHeight),
	};
}

export function applyRuntimeTiming(runtime: Runtime, timing: ResolvedRuntimeTiming): void {
	runtime.applyUfpsScaled(timing.ufpsScaled);
	runtime.timing.gpuDisplayModeWord = timing.gpuDisplayModeWord >>> 0;
	runtime.timing.totalScanlines = timing.totalScanlines;
	runtime.machine.gxGpu.writeDisplayModeWord(runtime.timing.gpuDisplayModeWord);
	setFrameTiming(runtime, timing.cpuHz, timing.cycleBudgetPerFrame, timing.vblankCycles);
	setTransferRates(runtime, {
		dmaBytesPerSec: timing.dmaBytesPerSec,
		geoWorkUnitsPerSec: timing.geoWorkUnitsPerSec,
	});
}
