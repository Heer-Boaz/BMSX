#include "machine/runtime/timing/state.h"

#include "machine/devices/gx/gpu_pcrtc.h"
#include "spec/bmsx/model.h"
#include "spec/bmsx/timing.h"
#include "machine/runtime/timing/index.h"

namespace bmsx {

TimingState::TimingState(const MachineModelSpec& model)
	: ufpsScaled(GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED)
	, ufps(static_cast<f64>(GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED) / static_cast<f64>(HZ_SCALE))
	, frameDurationMs(1000.0 / ufps)
	, pcrtcRunning(true)
	, totalHalfLines(GX_GPU_PCRTC_RESET_TOTAL_HALF_LINES)
	, activeDisplayHalfLines(GX_GPU_PCRTC_RESET_ACTIVE_DISPLAY_HALF_LINES)
	, cpuHz(model.cpuFreqHz)
	, cpuCyclesPerMillisecond(static_cast<f64>(model.cpuFreqHz) / 1000.0)
	, cycleBudgetPerFrame(calcCyclesPerFrameScaled(
		model.cpuFreqHz,
		GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED))
	, geoWorkUnitsPerSec(model.geoWorkUnitsPerSec) {
}

} // namespace bmsx
