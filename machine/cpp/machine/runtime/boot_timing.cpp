#include "machine/runtime/boot_timing.h"

#include "machine/model_registry.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "machine/runtime/timing/index.h"

namespace bmsx {

ResolvedRuntimeTiming resolveRuntimeTiming(i64 cpuHz) {
	return {
		true,
		GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED,
		GX_GPU_PCRTC_RESET_TOTAL_HALF_LINES,
		GX_GPU_PCRTC_RESET_ACTIVE_DISPLAY_HALF_LINES,
		cpuHz,
		static_cast<int>(PSX_MACHINE_SPEC.geoWorkUnitsPerSec),
		calcCyclesPerFrameScaled(cpuHz, GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED),
	};
}

} // namespace bmsx
