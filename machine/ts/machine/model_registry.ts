import { HZ_SCALE } from './runtime/timing/constants';

// Console-model registry: the machine owns fixed PSX-class hardware, device
// throughput/programming-model parameters, and PSX GPU display timing state.

export type MachineVdpClass = 'psx';
export type PsxGpuVideoStandard = 'pal' | 'ntsc';

export const PSX_CPU_FREQ_HZ = 50_000_000;
export const PSX_DMA_WORDS_PER_SEC = 6_553_600;
export const PSX_RAM_BYTES = 0x00400000;
export const PSX_GPU_MAX_DISPLAY_WIDTH = 640;
export const PSX_GPU_MAX_DISPLAY_HEIGHT = 480;
export const PSX_GPU_DISPLAY_ASPECT_WIDTH = 4;
export const PSX_GPU_DISPLAY_ASPECT_HEIGHT = 3;

export const PSX_GEO_WORK_UNITS_PER_SEC = 16_384_000;

export const PAL_REFRESH_UFPS_SCALED = 50 * HZ_SCALE;
export const PAL_TOTAL_SCANLINES = 313;
export const NTSC_REFRESH_UFPS_SCALED = 59_940_060;
export const NTSC_TOTAL_SCANLINES = 262;
export const PSX_GPU_DISPLAY_MODE_NTSC_WORD = 0x00000000;
export const PSX_GPU_DISPLAY_MODE_PAL_BIT = 0x00000008;
export const PSX_GPU_DISPLAY_MODE_PAL_WORD = PSX_GPU_DISPLAY_MODE_PAL_BIT;

export type MachineModelSpec = {
	cpuFreqHz: number;
	dmaWordsPerSec: number;
	ramBytes: number;
	geoWorkUnitsPerSec: number;
};

export type PsxGpuDisplayModeTiming = {
	videoStandard: PsxGpuVideoStandard;
	refreshUfpsScaled: number;
	totalScanlines: number;
};

export const PSX_MACHINE_SPEC: MachineModelSpec = {
	cpuFreqHz: PSX_CPU_FREQ_HZ,
	dmaWordsPerSec: PSX_DMA_WORDS_PER_SEC,
	ramBytes: PSX_RAM_BYTES,
	geoWorkUnitsPerSec: PSX_GEO_WORK_UNITS_PER_SEC,
};

export function getPsxGpuVideoStandardTiming(videoStandard: PsxGpuVideoStandard): PsxGpuDisplayModeTiming {
	if (videoStandard === 'pal') {
		return { videoStandard, refreshUfpsScaled: PAL_REFRESH_UFPS_SCALED, totalScanlines: PAL_TOTAL_SCANLINES };
	}
	return { videoStandard, refreshUfpsScaled: NTSC_REFRESH_UFPS_SCALED, totalScanlines: NTSC_TOTAL_SCANLINES };
}

function decodePsxGpuDisplayModeWord(word: number): PsxGpuVideoStandard {
	return (word & PSX_GPU_DISPLAY_MODE_PAL_BIT) !== 0 ? 'pal' : 'ntsc';
}

export function getPsxGpuDisplayModeTimingForWord(word: number): PsxGpuDisplayModeTiming {
	return getPsxGpuVideoStandardTiming(decodePsxGpuDisplayModeWord(word));
}
