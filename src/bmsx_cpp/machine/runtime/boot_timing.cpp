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
	timing.imgDecBytesPerSec = requirePositiveManifestValue(timingMachine.imgDecBytesPerSec, "[RuntimeMachineSpecs] machine.specs.cpu.imgdec_bytes_per_sec is required.", "[RuntimeMachineSpecs] machine.specs.cpu.imgdec_bytes_per_sec must be a positive integer.");
	timing.dmaBytesPerSecIso = requirePositiveManifestValue(timingMachine.dmaBytesPerSecIso, "[RuntimeMachineSpecs] machine.specs.dma.dma_bytes_per_sec_iso is required.", "[RuntimeMachineSpecs] machine.specs.dma.dma_bytes_per_sec_iso must be a positive integer.");
	timing.dmaBytesPerSecBulk = requirePositiveManifestValue(timingMachine.dmaBytesPerSecBulk, "[RuntimeMachineSpecs] machine.specs.dma.dma_bytes_per_sec_bulk is required.", "[RuntimeMachineSpecs] machine.specs.dma.dma_bytes_per_sec_bulk must be a positive integer.");
	timing.vdpWorkUnitsPerSec = static_cast<int>(resolvePositiveManifestValue(timingMachine.vdpWorkUnitsPerSec, DEFAULT_VDP_WORK_UNITS_PER_SEC, "[RuntimeMachineSpecs] machine.specs.vdp.work_units_per_sec must be a positive integer."));
	timing.geoWorkUnitsPerSec = static_cast<int>(resolvePositiveManifestValue(timingMachine.geoWorkUnitsPerSec, DEFAULT_GEO_WORK_UNITS_PER_SEC, "[RuntimeMachineSpecs] machine.specs.geo.work_units_per_sec must be a positive integer."));
	timing.cycleBudgetPerFrame = calcCyclesPerFrame(cpuHz, ufpsScaled);
	timing.vblankCycles = static_cast<int>(resolveVblankCycles(cpuHz, ufpsScaled, timingMachine.viewportHeight));
	return timing;
}

void applyRuntimeTiming(Runtime& runtime, const ResolvedRuntimeTiming& timing) {
	runtime.timing.applyUfpsScaled(timing.ufpsScaled);
	setFrameTiming(runtime, timing.cpuHz, timing.cycleBudgetPerFrame, timing.vblankCycles);
	setTransferRatesFromManifest(runtime, {
		timing.imgDecBytesPerSec,
		timing.dmaBytesPerSecIso,
		timing.dmaBytesPerSecBulk,
		timing.vdpWorkUnitsPerSec,
		timing.geoWorkUnitsPerSec,
	});
}

} // namespace bmsx
