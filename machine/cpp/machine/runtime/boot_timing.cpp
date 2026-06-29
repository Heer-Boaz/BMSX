#include "machine/runtime/boot_timing.h"

#include "machine/memory/specs.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/timing/config.h"
#include "machine/specs.h"
#include "machine/model_registry.h"
#include "rompack/format.h"

namespace bmsx {

ResolvedRuntimeTiming resolveRuntimeTiming(
	const MachineManifest& viewportMachine,
	const MachineManifest& timingMachine,
	i64 cpuHz,
	uint32_t regionWord
) {
	const RuntimeRenderSize renderSize = resolveRuntimeRenderSize(viewportMachine);
	const MachineRegionTiming regionTiming = getMachineRegionTimingForWord(regionWord);
	return {
		renderSize.width,
		renderSize.height,
		regionWord,
		regionTiming.refreshUfpsScaled,
		regionTiming.totalScanlines,
		cpuHz,
		PSX_MODEL_PROFILE.imgDecBytesPerSec,
		PSX_MODEL_PROFILE.dmaBytesPerSecIso,
		PSX_MODEL_PROFILE.dmaBytesPerSecBulk,
		static_cast<int>(PSX_VDP_CLASS_PROFILE.vdpWorkUnitsPerSec),
		static_cast<int>(PSX_VDP_CLASS_PROFILE.geoWorkUnitsPerSec),
		static_cast<int>(calcCyclesPerFrameScaled(cpuHz, regionTiming.refreshUfpsScaled)),
		static_cast<int>(resolveVblankCycles(cpuHz, regionTiming.refreshUfpsScaled, regionTiming.totalScanlines, timingMachine.viewportHeight)),
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
