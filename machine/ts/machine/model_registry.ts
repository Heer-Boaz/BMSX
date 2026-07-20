import { HZ_SCALE } from './runtime/timing/constants';

// Console-model registry: the machine owns fixed PSX-class raster hardware,
// PS2-class PCRTC presentation aspect, and device throughput/timing parameters.

export type MachineVdpClass = 'psx';
export type PsxGpuVideoStandard = 'pal' | 'ntsc';

export const PSX_CPU_FREQ_HZ = 33_868_800; // 44100 * 768, the real PS1 CPU clock
export const PSX_DMA_RAM_BASE_CYCLES_PER_WORD = 4;
export const PSX_DMA_WORDS_PER_SEC = PSX_CPU_FREQ_HZ / PSX_DMA_RAM_BASE_CYCLES_PER_WORD;
export const PSX_DMA_RAM_ROW_WORDS = 16;
export const PSX_DMA_RAM_ROW_REOPEN_CYCLES = 12;
export const PSX_DMA_ROM_WAIT_CYCLES_PER_WORD = 10;
export const PSX_RAM_BYTES = 0x00400000;
export const GX_GPU_DISPLAY_ASPECT_WIDTH = 4;
export const GX_GPU_DISPLAY_ASPECT_HEIGHT = 3;

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
	dmaRamRowReopenCycles: number;
	dmaRomWaitCyclesPerWord: number;
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
	dmaRamRowReopenCycles: PSX_DMA_RAM_ROW_REOPEN_CYCLES,
	dmaRomWaitCyclesPerWord: PSX_DMA_ROM_WAIT_CYCLES_PER_WORD,
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
