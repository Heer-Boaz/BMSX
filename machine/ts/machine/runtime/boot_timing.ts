import type { Runtime } from './runtime';
import { calcCyclesPerFrameScaled, resolveVblankCycles } from './timing';
import { setFrameTiming, setTransferRates } from './timing/config';
import { getMachineRegionTimingForWord, getMachineVdpModeProfile, PSX_MODEL_PROFILE, PSX_VDP_CLASS_PROFILE } from '../model_registry';

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
	cpuHz: number,
	regionWord: number,
): ResolvedRuntimeTiming {
	const renderSize = getMachineVdpModeProfile(PSX_MODEL_PROFILE.biosVdpMode);
	const regionTiming = getMachineRegionTimingForWord(regionWord);
	const refreshUfpsScaled = regionTiming.refreshUfpsScaled;
	return {
		viewportWidth: renderSize.renderWidth,
		viewportHeight: renderSize.renderHeight,
		regionWord,
		ufpsScaled: refreshUfpsScaled,
		totalScanlines: regionTiming.totalScanlines,
		cpuHz,
		imgDecBytesPerSec: PSX_MODEL_PROFILE.imgDecBytesPerSec,
		dmaBytesPerSecIso: PSX_MODEL_PROFILE.dmaBytesPerSecIso,
		dmaBytesPerSecBulk: PSX_MODEL_PROFILE.dmaBytesPerSecBulk,
		vdpWorkUnitsPerSec: PSX_VDP_CLASS_PROFILE.vdpWorkUnitsPerSec,
		geoWorkUnitsPerSec: PSX_VDP_CLASS_PROFILE.geoWorkUnitsPerSec,
		cycleBudgetPerFrame: calcCyclesPerFrameScaled(cpuHz, refreshUfpsScaled),
		vblankCycles: resolveVblankCycles(cpuHz, refreshUfpsScaled, regionTiming.totalScanlines, renderSize.renderHeight),
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
