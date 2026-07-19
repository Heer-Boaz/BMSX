import { calcCyclesPerFrameScaled } from './timing';
import { PSX_MACHINE_SPEC } from '../model_registry';
import {
	GX_GPU_PCRTC_RESET_ACTIVE_DISPLAY_HALF_LINES,
	GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED,
	GX_GPU_PCRTC_RESET_TOTAL_HALF_LINES,
} from '../devices/gx/gpu_pcrtc';

export type ResolvedRuntimeTiming = {
	pcrtcRunning: boolean;
	ufpsScaled: number;
	totalHalfLines: number;
	activeDisplayHalfLines: number;
	cpuHz: number;
	dmaWordsPerSec: number;
	geoWorkUnitsPerSec: number;
	cycleBudgetPerFrame: number;
};

export function resolveRuntimeTiming(cpuHz: number): ResolvedRuntimeTiming {
	return {
		pcrtcRunning: true,
		ufpsScaled: GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED,
		totalHalfLines: GX_GPU_PCRTC_RESET_TOTAL_HALF_LINES,
		activeDisplayHalfLines: GX_GPU_PCRTC_RESET_ACTIVE_DISPLAY_HALF_LINES,
		cpuHz,
		dmaWordsPerSec: PSX_MACHINE_SPEC.dmaWordsPerSec,
		geoWorkUnitsPerSec: PSX_MACHINE_SPEC.geoWorkUnitsPerSec,
		cycleBudgetPerFrame: calcCyclesPerFrameScaled(cpuHz, GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED),
	};
}
