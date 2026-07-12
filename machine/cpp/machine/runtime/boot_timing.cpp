#include "machine/runtime/boot_timing.h"

#include "machine/runtime/runtime.h"
#include "machine/runtime/timing/config.h"
#include "machine/model_registry.h"
#include "machine/devices/gx/gpu_display.h"

namespace bmsx {

ResolvedRuntimeTiming resolveRuntimeTiming(
	i64 cpuHz,
	uint32_t gpuDisplayModeWord
) {
	const PsxGpuDisplayModeTiming displayModeTiming = getPsxGpuDisplayModeTimingForWord(gpuDisplayModeWord);
	const i32 activeHeight = gxGpuVerticalVisibleLines(GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD, gpuDisplayModeWord);
	return {
		gpuDisplayModeWord,
		displayModeTiming.refreshUfpsScaled,
		displayModeTiming.totalScanlines,
		cpuHz,
		PSX_MACHINE_SPEC.dmaBytesPerSec,
		static_cast<int>(PSX_MACHINE_SPEC.geoWorkUnitsPerSec),
		static_cast<int>(calcCyclesPerFrameScaled(cpuHz, displayModeTiming.refreshUfpsScaled)),
		static_cast<int>(resolveVblankCycles(cpuHz, displayModeTiming.refreshUfpsScaled, displayModeTiming.totalScanlines, activeHeight)),
	};
}

void applyRuntimeTiming(Runtime& runtime, const ResolvedRuntimeTiming& timing) {
	runtime.applyUfpsScaled(timing.ufpsScaled);
	runtime.timing.gpuDisplayModeWord = timing.gpuDisplayModeWord;
	runtime.timing.gpuVerticalDisplayRangeWord = GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD;
	runtime.timing.totalScanlines = timing.totalScanlines;
	runtime.machine.gxGpu.writeDisplayModeWord(runtime.timing.gpuDisplayModeWord);
	setFrameTiming(runtime, timing.cpuHz, timing.cycleBudgetPerFrame, timing.vblankCycles);
	setTransferRates(runtime, {
		timing.dmaBytesPerSec,
		timing.geoWorkUnitsPerSec,
	});
}

} // namespace bmsx
