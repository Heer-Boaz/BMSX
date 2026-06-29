#include "machine/model_registry.h"

namespace bmsx {

MachineRegionTiming getMachineRegionTiming(MachineRegion region) {
	if (region == MachineRegion::Pal) {
		MachineRegionTiming timing;
		timing.region = region;
		timing.refreshUfpsScaled = PAL_REFRESH_UFPS_SCALED;
		timing.totalScanlines = PAL_TOTAL_SCANLINES;
		return timing;
	}

	MachineRegionTiming timing;
	timing.region = region;
	timing.refreshUfpsScaled = NTSC_REFRESH_UFPS_SCALED;
	timing.totalScanlines = NTSC_TOTAL_SCANLINES;
	return timing;
}

} // namespace bmsx
