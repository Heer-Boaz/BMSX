#include "machine/model_registry.h"

namespace bmsx {

MachineRegionTiming getMachineRegionTiming(MachineRegion region) {
	if (region == MachineRegion::Pal) {
		return { region, PAL_REFRESH_UFPS_SCALED, PAL_TOTAL_SCANLINES };
	}
	return { region, NTSC_REFRESH_UFPS_SCALED, NTSC_TOTAL_SCANLINES };
}

static MachineRegion decodeMachineRegionWord(uint32_t word) {
	return (word & MACHINE_REGION_NTSC_WORD) == 0 ? MachineRegion::Pal : MachineRegion::Ntsc;
}

MachineRegionTiming getMachineRegionTimingForWord(uint32_t word) {
	return getMachineRegionTiming(decodeMachineRegionWord(word));
}

} // namespace bmsx
