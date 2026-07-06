#include "machine/runtime/boot_timing.h"

#include "machine/runtime/runtime.h"
#include "machine/runtime/timing/config.h"
#include "machine/model_registry.h"

namespace bmsx {

ResolvedRuntimeTiming resolveRuntimeTiming(
	i64 cpuHz,
	uint32_t regionWord
) {
	const MachineVdpModeSpec& renderSize = PSX_VDP_MODE_SPEC;
	const MachineRegionTiming regionTiming = getMachineRegionTimingForWord(regionWord);
	return {
		renderSize.renderWidth,
		renderSize.renderHeight,
		regionWord,
		regionTiming.refreshUfpsScaled,
		regionTiming.totalScanlines,
		cpuHz,
		PSX_MACHINE_SPEC.imgDecBytesPerSec,
		PSX_MACHINE_SPEC.dmaBytesPerSecIso,
		PSX_MACHINE_SPEC.dmaBytesPerSecBulk,
		static_cast<int>(PSX_VDP_WORK_SPEC.vdpWorkUnitsPerSec),
		static_cast<int>(PSX_VDP_WORK_SPEC.geoWorkUnitsPerSec),
		static_cast<int>(calcCyclesPerFrameScaled(cpuHz, regionTiming.refreshUfpsScaled)),
		static_cast<int>(resolveVblankCycles(cpuHz, regionTiming.refreshUfpsScaled, regionTiming.totalScanlines, renderSize.renderHeight)),
	};
}

void applyRuntimeTiming(Runtime& runtime, const ResolvedRuntimeTiming& timing) {
	runtime.applyUfpsScaled(timing.ufpsScaled);
	runtime.timing.regionWord = timing.regionWord;
	runtime.timing.totalScanlines = timing.totalScanlines;
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
