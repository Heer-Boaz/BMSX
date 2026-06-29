#include "machine/model_registry.h"

namespace bmsx {

static MachineModelProfile bmsxProfile(MachineRegion region, i64 refreshUfpsScaled, i64 totalScanlines) {
	MachineModelProfile profile;
	profile.family = MachineFamily::Bmsx;
	profile.region = region;
	profile.cpuFreqHz = BMSX_CPU_FREQ_HZ;
	profile.refreshUfpsScaled = refreshUfpsScaled;
	profile.totalScanlines = totalScanlines;
	profile.imgDecBytesPerSec = BMSX_IMGDEC_BYTES_PER_SEC;
	profile.dmaBytesPerSecIso = BMSX_DMA_BYTES_PER_SEC_ISO;
	profile.dmaBytesPerSecBulk = BMSX_DMA_BYTES_PER_SEC_BULK;
	profile.vdpWorkUnitsPerSec = BMSX_VDP_WORK_UNITS_PER_SEC;
	profile.geoWorkUnitsPerSec = BMSX_GEO_WORK_UNITS_PER_SEC;
	profile.ramBytes = BMSX_RAM_BYTES;
	profile.slotBytes = BMSX_VRAM_SLOT_BYTES;
	profile.stagingBytes = BMSX_VRAM_STAGING_BYTES;
	return profile;
}

static MachineModelProfile bsxProfile(MachineRegion region, i64 refreshUfpsScaled, i64 totalScanlines) {
	MachineModelProfile profile;
	profile.family = MachineFamily::Bsx;
	profile.region = region;
	profile.cpuFreqHz = BSX_CPU_FREQ_HZ;
	profile.refreshUfpsScaled = refreshUfpsScaled;
	profile.totalScanlines = totalScanlines;
	profile.imgDecBytesPerSec = BSX_IMGDEC_BYTES_PER_SEC;
	profile.dmaBytesPerSecIso = BSX_DMA_BYTES_PER_SEC_ISO;
	profile.dmaBytesPerSecBulk = BSX_DMA_BYTES_PER_SEC_BULK;
	profile.vdpWorkUnitsPerSec = BSX_VDP_WORK_UNITS_PER_SEC;
	profile.geoWorkUnitsPerSec = BSX_GEO_WORK_UNITS_PER_SEC;
	profile.ramBytes = BSX_RAM_BYTES;
	profile.slotBytes = BSX_VRAM_SLOT_BYTES;
	profile.stagingBytes = BSX_VRAM_STAGING_BYTES;
	return profile;
}

MachineFamily machineFamilyOfModel(MachineModelId model) {
	return model == MachineModelId::BsxNtsc ? MachineFamily::Bsx : MachineFamily::Bmsx;
}

MachineModelProfile getMachineModelProfile(MachineModelId model) {
	if (model == MachineModelId::BmsxPal) {
		return bmsxProfile(MachineRegion::Pal, PAL_REFRESH_UFPS_SCALED, PAL_TOTAL_SCANLINES);
	}
	if (model == MachineModelId::BmsxNtsc) {
		return bmsxProfile(MachineRegion::Ntsc, NTSC_REFRESH_UFPS_SCALED, NTSC_TOTAL_SCANLINES);
	}
	return bsxProfile(MachineRegion::Ntsc, NTSC_REFRESH_UFPS_SCALED, NTSC_TOTAL_SCANLINES);
}

} // namespace bmsx
