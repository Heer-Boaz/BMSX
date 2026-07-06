#include "machine/runtime/boot_timing.h"

#include "machine/runtime/runtime.h"
#include "machine/runtime/timing/config.h"
#include "machine/model_registry.h"

namespace bmsx {

ResolvedRuntimeTiming resolveRuntimeTiming(
	i64 cpuHz,
	uint32_t gpuDisplayModeWord
) {
	const PsxGpuDisplaySizeSpec& renderSize = PSX_GPU_DISPLAY_SIZE_SPEC;
	const PsxGpuDisplayModeTiming displayModeTiming = getPsxGpuDisplayModeTimingForWord(gpuDisplayModeWord);
	return {
		renderSize.renderWidth,
		renderSize.renderHeight,
		gpuDisplayModeWord,
		displayModeTiming.refreshUfpsScaled,
		displayModeTiming.totalScanlines,
		cpuHz,
		PSX_MACHINE_SPEC.imgDecBytesPerSec,
		PSX_MACHINE_SPEC.dmaBytesPerSecIso,
		PSX_MACHINE_SPEC.dmaBytesPerSecBulk,
		static_cast<int>(PSX_VDP_WORK_SPEC.vdpWorkUnitsPerSec),
		static_cast<int>(PSX_VDP_WORK_SPEC.geoWorkUnitsPerSec),
		static_cast<int>(calcCyclesPerFrameScaled(cpuHz, displayModeTiming.refreshUfpsScaled)),
		static_cast<int>(resolveVblankCycles(cpuHz, displayModeTiming.refreshUfpsScaled, displayModeTiming.totalScanlines, renderSize.renderHeight)),
	};
}

void applyRuntimeTiming(Runtime& runtime, const ResolvedRuntimeTiming& timing) {
	runtime.applyUfpsScaled(timing.ufpsScaled);
	runtime.timing.gpuDisplayModeWord = timing.gpuDisplayModeWord;
	runtime.timing.totalScanlines = timing.totalScanlines;
	runtime.machine.vdp.writeDisplayModeWord(runtime.timing.gpuDisplayModeWord);
	setFrameTiming(runtime, timing.cpuHz, timing.cycleBudgetPerFrame, timing.vblankCycles);
	setTransferRates(runtime, {
		timing.imgDecBytesPerSec,
		timing.dmaBytesPerSecIso,
		timing.dmaBytesPerSecBulk,
		timing.vdpWorkUnitsPerSec,
		timing.geoWorkUnitsPerSec,
	});
}

} // namespace bmsx
