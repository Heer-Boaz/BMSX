#include "machine/model_registry.h"

namespace bmsx {

PsxGpuDisplayModeTiming getPsxGpuVideoStandardTiming(PsxGpuVideoStandard videoStandard) {
	if (videoStandard == PsxGpuVideoStandard::Pal) {
		return { videoStandard, PAL_REFRESH_UFPS_SCALED, PAL_TOTAL_SCANLINES };
	}
	return { videoStandard, NTSC_REFRESH_UFPS_SCALED, NTSC_TOTAL_SCANLINES };
}

static PsxGpuVideoStandard decodePsxGpuDisplayModeWord(uint32_t word) {
	return (word & PSX_GPU_DISPLAY_MODE_PAL_BIT) != 0u ? PsxGpuVideoStandard::Pal : PsxGpuVideoStandard::Ntsc;
}

PsxGpuDisplayModeTiming getPsxGpuDisplayModeTimingForWord(uint32_t word) {
	return getPsxGpuVideoStandardTiming(decodePsxGpuDisplayModeWord(word));
}

} // namespace bmsx
