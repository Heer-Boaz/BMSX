import { HZ_SCALE } from './runtime/timing/constants';

// Console-model registry: the machine owns fixed PSX-class hardware, device
// throughput/programming-model parameters, and PSX GPU display timing state.

export type MachineVdpClass = 'psx';
export type PsxGpuVideoStandard = 'pal' | 'ntsc';

export const PSX_CPU_FREQ_HZ = 50_000_000;
export const PSX_IMGDEC_BYTES_PER_SEC = 26_214_400;
export const PSX_DMA_BYTES_PER_SEC_ISO = 8_388_608;
export const PSX_DMA_BYTES_PER_SEC_BULK = 26_214_400;
export const PSX_RAM_BYTES = 0x00400000;
export const PSX_VRAM_TEXTURE_BYTES = 0x00200000;
export const PSX_VRAM_STAGING_BYTES = 0x00022000;
export const PSX_GPU_DISPLAY_WIDTH = 320;
export const PSX_GPU_DISPLAY_HEIGHT = 240;

export const PSX_VDP_WORK_UNITS_PER_SEC = 25_600;
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
	imgDecBytesPerSec: number;
	dmaBytesPerSecIso: number;
	dmaBytesPerSecBulk: number;
	ramBytes: number;
	textureBytes: number;
	stagingBytes: number;
};

export type MachineVdpWorkSpec = {
	vdpWorkUnitsPerSec: number;
	geoWorkUnitsPerSec: number;
};

export type PsxGpuDisplaySizeSpec = {
	renderWidth: number;
	renderHeight: number;
};

export type PsxGpuDisplayModeTiming = {
	videoStandard: PsxGpuVideoStandard;
	refreshUfpsScaled: number;
	totalScanlines: number;
};

export const PSX_MACHINE_SPEC: MachineModelSpec = {
	cpuFreqHz: PSX_CPU_FREQ_HZ,
	imgDecBytesPerSec: PSX_IMGDEC_BYTES_PER_SEC,
	dmaBytesPerSecIso: PSX_DMA_BYTES_PER_SEC_ISO,
	dmaBytesPerSecBulk: PSX_DMA_BYTES_PER_SEC_BULK,
	ramBytes: PSX_RAM_BYTES,
	textureBytes: PSX_VRAM_TEXTURE_BYTES,
	stagingBytes: PSX_VRAM_STAGING_BYTES,
};

export const PSX_VDP_WORK_SPEC: MachineVdpWorkSpec = {
	vdpWorkUnitsPerSec: PSX_VDP_WORK_UNITS_PER_SEC,
	geoWorkUnitsPerSec: PSX_GEO_WORK_UNITS_PER_SEC,
};

export const PSX_GPU_DISPLAY_SIZE_SPEC: PsxGpuDisplaySizeSpec = {
	renderWidth: PSX_GPU_DISPLAY_WIDTH,
	renderHeight: PSX_GPU_DISPLAY_HEIGHT,
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
