import type { MachineManifest } from '../../rompack/format';
import type { Runtime } from './runtime';
import { resolveRuntimeRenderSize } from '../specs';
import { calcCyclesPerFrameScaled, resolveVblankCycles } from './timing';
import { setFrameTiming, setTransferRates } from './timing/config';
import { getMachineRegionTimingForWord, PSX_MODEL_PROFILE, PSX_VDP_CLASS_PROFILE } from '../model_registry';

export type ResolvedRuntimeTiming = {
	viewportWidth: number;
	viewportHeight: number;
	regionWord: number;
	ufpsScaled: number;
	totalScanlines: number;
	cpuHz: number;
	imgDecBytesPerSec: number;
	dmaBytesPerSecIso: number;
	dmaBytesPerSecBulk: number;
	vdpWorkUnitsPerSec: number;
	geoWorkUnitsPerSec: number;
	cycleBudgetPerFrame: number;
	vblankCycles: number;
};

export function resolveRuntimeTiming(
	viewportMachine: MachineManifest,
	timingMachine: MachineManifest,
	cpuHz: number,
	regionWord: number,
): ResolvedRuntimeTiming {
	const renderSize = resolveRuntimeRenderSize(viewportMachine);
	const regionTiming = getMachineRegionTimingForWord(regionWord);
	return {
		viewportWidth: renderSize.width,
		viewportHeight: renderSize.height,
		regionWord,
		ufpsScaled: regionTiming.refreshUfpsScaled,
		totalScanlines: regionTiming.totalScanlines,
		cpuHz,
		imgDecBytesPerSec: PSX_MODEL_PROFILE.imgDecBytesPerSec,
		dmaBytesPerSecIso: PSX_MODEL_PROFILE.dmaBytesPerSecIso,
		dmaBytesPerSecBulk: PSX_MODEL_PROFILE.dmaBytesPerSecBulk,
		vdpWorkUnitsPerSec: PSX_VDP_CLASS_PROFILE.vdpWorkUnitsPerSec,
		geoWorkUnitsPerSec: PSX_VDP_CLASS_PROFILE.geoWorkUnitsPerSec,
		cycleBudgetPerFrame: calcCyclesPerFrameScaled(cpuHz, regionTiming.refreshUfpsScaled),
		vblankCycles: resolveVblankCycles(cpuHz, regionTiming.refreshUfpsScaled, regionTiming.totalScanlines, timingMachine.render_size.height),
	};
}

export function applyRuntimeTiming(runtime: Runtime, timing: ResolvedRuntimeTiming): void {
	runtime.applyUfpsScaled(timing.ufpsScaled);
	runtime.timing.regionWord = timing.regionWord >>> 0;
	runtime.timing.totalScanlines = timing.totalScanlines;
	setFrameTiming(runtime, timing.cpuHz, timing.cycleBudgetPerFrame, timing.vblankCycles);
	setTransferRates(runtime, {
		imgDecBytesPerSec: timing.imgDecBytesPerSec,
		dmaBytesPerSecIso: timing.dmaBytesPerSecIso,
		dmaBytesPerSecBulk: timing.dmaBytesPerSecBulk,
		vdpWorkUnitsPerSec: timing.vdpWorkUnitsPerSec,
		geoWorkUnitsPerSec: timing.geoWorkUnitsPerSec,
	});
}
