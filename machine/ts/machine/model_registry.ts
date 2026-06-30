import { HZ_SCALE } from './runtime/timing/constants';

// Console-model registry: the machine owns fixed hardware, device classes own
// throughput/programming-model parameters, and region is runtime timing state.
// Slice 24.1 intentionally populates only the psx model + psx VDP class.

export type MachineVdpClass = 'psx';
export type MachineVdpMode = typeof VDP_MODE_MSX1_WORD | typeof VDP_MODE_MSX2_WORD | typeof VDP_MODE_PSX_WORD;
export type MachineRegion = 'pal' | 'ntsc';

export const PSX_CPU_FREQ_HZ = 50_000_000;
export const PSX_IMGDEC_BYTES_PER_SEC = 26_214_400;
export const PSX_DMA_BYTES_PER_SEC_ISO = 8_388_608;
export const PSX_DMA_BYTES_PER_SEC_BULK = 26_214_400;
export const PSX_RAM_BYTES = 0x08000000;
export const PSX_VRAM_SLOT_BYTES = 167_772_160;
export const PSX_VRAM_STAGING_BYTES = 41_943_040;
export const VDP_MODE_MSX1_WORD = 0;
export const VDP_MODE_MSX2_WORD = 1;
export const VDP_MODE_PSX_WORD = 2;
export const VDP_MODE_MSX1_RENDER_WIDTH = 256;
export const VDP_MODE_MSX1_RENDER_HEIGHT = 192;
export const VDP_MODE_MSX2_RENDER_WIDTH = 256;
export const VDP_MODE_MSX2_RENDER_HEIGHT = 212;
export const VDP_MODE_PSX_RENDER_WIDTH = 320;
export const VDP_MODE_PSX_RENDER_HEIGHT = 240;

export const PSX_VDP_WORK_UNITS_PER_SEC = 25_600;
export const PSX_GEO_WORK_UNITS_PER_SEC = 16_384_000;

export const PAL_REFRESH_UFPS_SCALED = 50 * HZ_SCALE;
export const PAL_TOTAL_SCANLINES = 313;
export const NTSC_REFRESH_UFPS_SCALED = 59_940_060;
export const NTSC_TOTAL_SCANLINES = 262;
export const MACHINE_REGION_PAL_WORD = 0;
export const MACHINE_REGION_NTSC_WORD = 1;

export type MachineModelProfile = {
	cpuFreqHz: number;
	imgDecBytesPerSec: number;
	dmaBytesPerSecIso: number;
	dmaBytesPerSecBulk: number;
	ramBytes: number;
	slotBytes: number;
	stagingBytes: number;
	biosVdpMode: MachineVdpMode;
};

export type MachineVdpClassProfile = {
	vdpWorkUnitsPerSec: number;
	geoWorkUnitsPerSec: number;
};

export type MachineVdpModeProfile = {
	mode: MachineVdpMode;
	renderWidth: number;
	renderHeight: number;
};

export type MachineRegionTiming = {
	region: MachineRegion;
	refreshUfpsScaled: number;
	totalScanlines: number;
};

export const PSX_MODEL_PROFILE: MachineModelProfile = {
	cpuFreqHz: PSX_CPU_FREQ_HZ,
	imgDecBytesPerSec: PSX_IMGDEC_BYTES_PER_SEC,
	dmaBytesPerSecIso: PSX_DMA_BYTES_PER_SEC_ISO,
	dmaBytesPerSecBulk: PSX_DMA_BYTES_PER_SEC_BULK,
	ramBytes: PSX_RAM_BYTES,
	slotBytes: PSX_VRAM_SLOT_BYTES,
	stagingBytes: PSX_VRAM_STAGING_BYTES,
	biosVdpMode: VDP_MODE_PSX_WORD,
};

export const PSX_VDP_CLASS_PROFILE: MachineVdpClassProfile = {
	vdpWorkUnitsPerSec: PSX_VDP_WORK_UNITS_PER_SEC,
	geoWorkUnitsPerSec: PSX_GEO_WORK_UNITS_PER_SEC,
};

export const VDP_MODE_MSX1_PROFILE: MachineVdpModeProfile = {
	mode: VDP_MODE_MSX1_WORD,
	renderWidth: VDP_MODE_MSX1_RENDER_WIDTH,
	renderHeight: VDP_MODE_MSX1_RENDER_HEIGHT,
};

export const VDP_MODE_MSX2_PROFILE: MachineVdpModeProfile = {
	mode: VDP_MODE_MSX2_WORD,
	renderWidth: VDP_MODE_MSX2_RENDER_WIDTH,
	renderHeight: VDP_MODE_MSX2_RENDER_HEIGHT,
};

export const VDP_MODE_PSX_PROFILE: MachineVdpModeProfile = {
	mode: VDP_MODE_PSX_WORD,
	renderWidth: VDP_MODE_PSX_RENDER_WIDTH,
	renderHeight: VDP_MODE_PSX_RENDER_HEIGHT,
};

export function getMachineVdpModeProfile(mode: MachineVdpMode): MachineVdpModeProfile {
	switch (mode) {
		case VDP_MODE_MSX1_WORD:
			return VDP_MODE_MSX1_PROFILE;
		case VDP_MODE_MSX2_WORD:
			return VDP_MODE_MSX2_PROFILE;
		case VDP_MODE_PSX_WORD:
			return VDP_MODE_PSX_PROFILE;
	}
}

export function getMachineRegionTiming(region: MachineRegion): MachineRegionTiming {
	if (region === 'pal') {
		return { region, refreshUfpsScaled: PAL_REFRESH_UFPS_SCALED, totalScanlines: PAL_TOTAL_SCANLINES };
	}
	return { region, refreshUfpsScaled: NTSC_REFRESH_UFPS_SCALED, totalScanlines: NTSC_TOTAL_SCANLINES };
}

function decodeMachineRegionWord(word: number): MachineRegion {
	return (word & MACHINE_REGION_NTSC_WORD) === 0 ? 'pal' : 'ntsc';
}

export function getMachineRegionTimingForWord(word: number): MachineRegionTiming {
	return getMachineRegionTiming(decodeMachineRegionWord(word));
}
