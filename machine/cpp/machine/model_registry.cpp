#include "machine/model_registry.h"
#include <stdexcept>

namespace bmsx {

const MachineVdpModeProfile& getMachineVdpModeProfile(MachineVdpMode mode) {
	switch (mode) {
		case MachineVdpMode::Msx1:
			return VDP_MODE_MSX1_PROFILE;
		case MachineVdpMode::Msx2:
			return VDP_MODE_MSX2_PROFILE;
		case MachineVdpMode::Psx:
			return VDP_MODE_PSX_PROFILE;
	}
	throw std::runtime_error("[MachineModelRegistry] Unsupported VDP mode.");
}

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
