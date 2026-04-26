#include "machine/runtime/timing/config.h"

#include "machine/runtime/runtime.h"
#include "machine/runtime/runtime_fault.h"
#include "rompack/assets.h"

#include <stdexcept>

namespace bmsx {
namespace {

int resolvePositiveWorkUnits(i64 value, const char* name) {
	if (value <= 0) {
		throw new Error(std::string(name) + " must be greater than 0.");
	}
	return static_cast<int>(value);
}

} // namespace

void refreshDeviceTimings(Runtime& runtime, i64 nowCycles) {
	const MachineTiming machineTiming{
		runtime.timing.cpuHz,
		runtime.timing.dmaBytesPerSecIso,
		runtime.timing.dmaBytesPerSecBulk,
		runtime.timing.imgDecBytesPerSec,
		runtime.timing.geoWorkUnitsPerSec,
		runtime.timing.vdpWorkUnitsPerSec,
	};
	runtime.machine().refreshDeviceTimings(machineTiming, nowCycles);
}

void setCpuHz(Runtime& runtime, i64 value) {
	runtime.timing.cpuHz = value;
	refreshDeviceTimings(runtime, runtime.machine().scheduler().currentNowCycles());
}

void setCycleBudgetPerFrame(Runtime& runtime, int value) {
	if (value == runtime.timing.cycleBudgetPerFrame) {
		return;
	}
	runtime.timing.cycleBudgetPerFrame = value;
	runtime.setGlobal("sys_max_cycles_per_frame", valueNumber(static_cast<double>(value)));
	refreshDeviceTimings(runtime, runtime.machine().scheduler().currentNowCycles());
	runtime.vblank.configureCycleBudget(runtime);
}

void setFrameTiming(Runtime& runtime, i64 cpuHz, int cycleBudgetPerFrame, int vblankCycles) {
	runtime.timing.cpuHz = cpuHz;
	if (cycleBudgetPerFrame != runtime.timing.cycleBudgetPerFrame) {
		runtime.timing.cycleBudgetPerFrame = cycleBudgetPerFrame;
		runtime.setGlobal("sys_max_cycles_per_frame", valueNumber(static_cast<double>(cycleBudgetPerFrame)));
	}
	runtime.vblank.setVblankCycles(runtime, vblankCycles);
}

void setRenderWorkUnitsPerSec(Runtime& runtime, int vdpValue, int geoValue) {
	runtime.timing.vdpWorkUnitsPerSec = resolvePositiveWorkUnits(vdpValue, "work_units_per_sec");
	runtime.timing.geoWorkUnitsPerSec = resolvePositiveWorkUnits(geoValue, "geo_work_units_per_sec");
	refreshDeviceTimings(runtime, runtime.machine().scheduler().currentNowCycles());
}

void setTransferRatesFromManifest(Runtime& runtime, const RuntimeTransferRates& rates) {
	runtime.timing.imgDecBytesPerSec = rates.imgDecBytesPerSec;
	runtime.timing.dmaBytesPerSecIso = rates.dmaBytesPerSecIso;
	runtime.timing.dmaBytesPerSecBulk = rates.dmaBytesPerSecBulk;
	runtime.timing.vdpWorkUnitsPerSec = resolvePositiveWorkUnits(rates.vdpWorkUnitsPerSec, "work_units_per_sec");
	runtime.timing.geoWorkUnitsPerSec = resolvePositiveWorkUnits(rates.geoWorkUnitsPerSec, "geo_work_units_per_sec");
	refreshDeviceTimings(runtime, runtime.machine().scheduler().currentNowCycles());
}

void applyActiveMachineTiming(Runtime& runtime, i64 cpuHz) {
	const MachineManifest& manifest = runtime.machineManifest();
	const int cycleBudget = calcCyclesPerFrame(cpuHz, runtime.timing.ufpsScaled);
	const i64 vblankCycles = resolveVblankCycles(cpuHz, runtime.timing.ufpsScaled, manifest.viewportHeight);
	setFrameTiming(runtime, cpuHz, cycleBudget, static_cast<int>(vblankCycles));
	// start value-or-boundary -- manifest render defaults are resolved at timing activation.
	setRenderWorkUnitsPerSec(
		runtime,
		manifest.vdpWorkUnitsPerSec.value_or(DEFAULT_VDP_WORK_UNITS_PER_SEC),
		manifest.geoWorkUnitsPerSec.value_or(DEFAULT_GEO_WORK_UNITS_PER_SEC)
	);
	// end value-or-boundary
}

} // namespace bmsx
