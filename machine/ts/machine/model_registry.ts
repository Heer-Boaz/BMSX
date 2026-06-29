import { HZ_SCALE } from './runtime/timing/constants';

// Machine-model registry: the machine owns its model (echte-console-model). The
// registry is the single source of truth for the hardware profile a given model
// exposes. Region (pal/ntsc) is video-timing only; the family-level hardware is
// shared so that a different RAM/clock for one region has to be an explicit edit
// rather than a silent divergence. See docs/open_architecture_slices.md slice 24.

export type MachineFamily = 'bmsx' | 'bsx';
export type MachineRegion = 'pal' | 'ntsc';
export type MachineModelId = 'bmsx_pal' | 'bmsx_ntsc' | 'bsx_ntsc';

// Family-shared hardware (bmsx = MSX-like lane).
export const BMSX_CPU_FREQ_HZ = 8_000_000;
export const BMSX_IMGDEC_BYTES_PER_SEC = 26_214_400;
export const BMSX_DMA_BYTES_PER_SEC_ISO = 8_388_608;
export const BMSX_DMA_BYTES_PER_SEC_BULK = 26_214_400;
export const BMSX_VDP_WORK_UNITS_PER_SEC = 25_600;
export const BMSX_GEO_WORK_UNITS_PER_SEC = 16_384_000;
export const BMSX_RAM_BYTES = 0x00400000;
export const BMSX_VRAM_SLOT_BYTES = 0x01000000;
export const BMSX_VRAM_STAGING_BYTES = 0x00400000;

// Family-shared hardware (bsx = PSX-like high-end lane).
export const BSX_CPU_FREQ_HZ = 50_000_000;
export const BSX_IMGDEC_BYTES_PER_SEC = 26_214_400;
export const BSX_DMA_BYTES_PER_SEC_ISO = 8_388_608;
export const BSX_DMA_BYTES_PER_SEC_BULK = 26_214_400;
export const BSX_VDP_WORK_UNITS_PER_SEC = 25_600;
export const BSX_GEO_WORK_UNITS_PER_SEC = 16_384_000;
export const BSX_RAM_BYTES = 0x08000000;
export const BSX_VRAM_SLOT_BYTES = 167_772_160;
export const BSX_VRAM_STAGING_BYTES = 41_943_040;

// Per-region video timing.
export const PAL_REFRESH_UFPS_SCALED = 50 * HZ_SCALE;
export const PAL_TOTAL_SCANLINES = 313;
export const NTSC_REFRESH_UFPS_SCALED = 60 * HZ_SCALE;
export const NTSC_TOTAL_SCANLINES = 262;

export type MachineModelProfile = {
	family: MachineFamily;
	region: MachineRegion;
	cpuFreqHz: number;
	refreshUfpsScaled: number;
	totalScanlines: number;
	imgDecBytesPerSec: number;
	dmaBytesPerSecIso: number;
	dmaBytesPerSecBulk: number;
	vdpWorkUnitsPerSec: number;
	geoWorkUnitsPerSec: number;
	ramBytes: number;
	slotBytes: number;
	stagingBytes: number;
};

function bmsxProfile(region: MachineRegion, refreshUfpsScaled: number, totalScanlines: number): MachineModelProfile {
	return {
		family: 'bmsx',
		region,
		cpuFreqHz: BMSX_CPU_FREQ_HZ,
		refreshUfpsScaled,
		totalScanlines,
		imgDecBytesPerSec: BMSX_IMGDEC_BYTES_PER_SEC,
		dmaBytesPerSecIso: BMSX_DMA_BYTES_PER_SEC_ISO,
		dmaBytesPerSecBulk: BMSX_DMA_BYTES_PER_SEC_BULK,
		vdpWorkUnitsPerSec: BMSX_VDP_WORK_UNITS_PER_SEC,
		geoWorkUnitsPerSec: BMSX_GEO_WORK_UNITS_PER_SEC,
		ramBytes: BMSX_RAM_BYTES,
		slotBytes: BMSX_VRAM_SLOT_BYTES,
		stagingBytes: BMSX_VRAM_STAGING_BYTES,
	};
}

function bsxProfile(region: MachineRegion, refreshUfpsScaled: number, totalScanlines: number): MachineModelProfile {
	return {
		family: 'bsx',
		region,
		cpuFreqHz: BSX_CPU_FREQ_HZ,
		refreshUfpsScaled,
		totalScanlines,
		imgDecBytesPerSec: BSX_IMGDEC_BYTES_PER_SEC,
		dmaBytesPerSecIso: BSX_DMA_BYTES_PER_SEC_ISO,
		dmaBytesPerSecBulk: BSX_DMA_BYTES_PER_SEC_BULK,
		vdpWorkUnitsPerSec: BSX_VDP_WORK_UNITS_PER_SEC,
		geoWorkUnitsPerSec: BSX_GEO_WORK_UNITS_PER_SEC,
		ramBytes: BSX_RAM_BYTES,
		slotBytes: BSX_VRAM_SLOT_BYTES,
		stagingBytes: BSX_VRAM_STAGING_BYTES,
	};
}

export function machineFamilyOfModel(model: MachineModelId): MachineFamily {
	return model === 'bsx_ntsc' ? 'bsx' : 'bmsx';
}

export function getMachineModelProfile(model: MachineModelId): MachineModelProfile {
	if (model === 'bmsx_pal') {
		return bmsxProfile('pal', PAL_REFRESH_UFPS_SCALED, PAL_TOTAL_SCANLINES);
	}
	if (model === 'bmsx_ntsc') {
		return bmsxProfile('ntsc', NTSC_REFRESH_UFPS_SCALED, NTSC_TOTAL_SCANLINES);
	}
	return bsxProfile('ntsc', NTSC_REFRESH_UFPS_SCALED, NTSC_TOTAL_SCANLINES);
}
