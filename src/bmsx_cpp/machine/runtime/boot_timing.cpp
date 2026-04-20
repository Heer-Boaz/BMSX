#include "machine/runtime/boot_timing.h"

#include "machine/memory/specs.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/timing_config.h"
#include "machine/specs.h"
#include "rompack/assets.h"

namespace bmsx {

ResolvedRuntimeTiming resolveRuntimeTiming(const MachineManifest& machine) {
	return resolveRuntimeTiming(machine, machine, resolveCpuHz(machine), resolveUfpsScaled(machine));
}

ResolvedRuntimeTiming resolveRuntimeTiming(
	const MachineManifest& viewportMachine,
	const MachineManifest& timingMachine,
	i64 cpuHz,
	i64 ufpsScaled
) {
	ResolvedRuntimeTiming timing{};
	timing.viewportWidth = viewportMachine.viewportWidth;
	timing.viewportHeight = viewportMachine.viewportHeight;
	timing.ufpsScaled = ufpsScaled;
	timing.cpuHz = cpuHz;
	timing.imgDecBytesPerSec = resolveImgDecBytesPerSec(timingMachine);
	timing.dmaBytesPerSecIso = resolveDmaBytesPerSecIso(timingMachine);
	timing.dmaBytesPerSecBulk = resolveDmaBytesPerSecBulk(timingMachine);
	timing.vdpWorkUnitsPerSec = static_cast<int>(resolveVdpWorkUnitsPerSec(timingMachine));
	timing.geoWorkUnitsPerSec = static_cast<int>(resolveGeoWorkUnitsPerSec(timingMachine));
	timing.cycleBudgetPerFrame = calcCyclesPerFrame(cpuHz, ufpsScaled);
	timing.vblankCycles = static_cast<int>(resolveVblankCycles(cpuHz, ufpsScaled, timingMachine.viewportHeight));
	return timing;
}

void applyRuntimeTiming(Runtime& runtime, const ResolvedRuntimeTiming& timing) {
	runtime.timing.applyUfpsScaled(timing.ufpsScaled);
	setCpuHz(runtime, timing.cpuHz);
	setCycleBudgetPerFrame(runtime, timing.cycleBudgetPerFrame);
	runtime.vblank.setVblankCycles(runtime, timing.vblankCycles);
	setTransferRatesFromManifest(runtime, {
		timing.imgDecBytesPerSec,
		timing.dmaBytesPerSecIso,
		timing.dmaBytesPerSecBulk,
		timing.vdpWorkUnitsPerSec,
		timing.geoWorkUnitsPerSec,
	});
}

} // namespace bmsx
