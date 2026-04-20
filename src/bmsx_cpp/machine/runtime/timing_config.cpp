#include "machine/runtime/timing_config.h"

#include "core/engine.h"
#include "machine/runtime/runtime.h"
#include "rompack/assets.h"

#include <stdexcept>

namespace bmsx {
namespace {

inline std::runtime_error runtimeFault(const std::string& message) {
	return BMSX_RUNTIME_ERROR("Runtime fault: " + message);
}

int resolvePositiveWorkUnits(i64 value, const char* name) {
	if (value <= 0) {
		throw runtimeFault(std::string(name) + " must be greater than 0.");
	}
	return static_cast<int>(value);
}

void updateDeviceTimings(Runtime& runtime) {
	refreshDeviceTimings(runtime, runtime.machine().scheduler().currentNowCycles());
}

void setWorkUnitsPerSec(Runtime& runtime, i64 value, const char* name, bool vdp) {
	const int workUnitsPerSec = resolvePositiveWorkUnits(value, name);
	if (vdp) {
		runtime.timing.vdpWorkUnitsPerSec = workUnitsPerSec;
		runtime.machine().vdp().setTiming(runtime.timing.cpuHz, runtime.timing.vdpWorkUnitsPerSec, runtime.machine().scheduler().currentNowCycles());
	} else {
		runtime.timing.geoWorkUnitsPerSec = workUnitsPerSec;
		runtime.machine().geometryController().setTiming(runtime.timing.cpuHz, runtime.timing.geoWorkUnitsPerSec, runtime.machine().scheduler().currentNowCycles());
	}
}

void setCycleBudget(Runtime& runtime, int value) {
	runtime.timing.cycleBudgetPerFrame = value;
	runtime.setGlobal("sys_max_cycles_per_frame", valueNumber(static_cast<double>(value)));
	updateDeviceTimings(runtime);
	runtime.vblank.configureCycleBudget(runtime);
}

} // namespace

void refreshDeviceTimings(Runtime& runtime, i64 nowCycles) {
	MachineTiming machineTiming{};
	machineTiming.cpuHz = runtime.timing.cpuHz;
	machineTiming.dmaBytesPerSecIso = runtime.timing.dmaBytesPerSecIso;
	machineTiming.dmaBytesPerSecBulk = runtime.timing.dmaBytesPerSecBulk;
	machineTiming.imgDecBytesPerSec = runtime.timing.imgDecBytesPerSec;
	machineTiming.geoWorkUnitsPerSec = runtime.timing.geoWorkUnitsPerSec;
	machineTiming.vdpWorkUnitsPerSec = runtime.timing.vdpWorkUnitsPerSec;
	runtime.machine().refreshDeviceTimings(machineTiming, nowCycles);
}

void setCpuHz(Runtime& runtime, i64 value) {
	if (value == runtime.timing.cpuHz) {
		return;
	}
	runtime.timing.cpuHz = value;
	updateDeviceTimings(runtime);
}

void setCycleBudgetPerFrame(Runtime& runtime, int value) {
	if (value == runtime.timing.cycleBudgetPerFrame) {
		return;
	}
	setCycleBudget(runtime, value);
}

void setVdpWorkUnitsPerSec(Runtime& runtime, int value) {
	setWorkUnitsPerSec(runtime, value, "work_units_per_sec", true);
}

void setGeoWorkUnitsPerSec(Runtime& runtime, int value) {
	setWorkUnitsPerSec(runtime, value, "geo_work_units_per_sec", false);
}

void setTransferRatesFromManifest(Runtime& runtime, const RuntimeTransferRates& rates) {
	runtime.timing.imgDecBytesPerSec = rates.imgDecBytesPerSec;
	runtime.timing.dmaBytesPerSecIso = rates.dmaBytesPerSecIso;
	runtime.timing.dmaBytesPerSecBulk = rates.dmaBytesPerSecBulk;
	setVdpWorkUnitsPerSec(runtime, rates.vdpWorkUnitsPerSec);
	setGeoWorkUnitsPerSec(runtime, rates.geoWorkUnitsPerSec);
	updateDeviceTimings(runtime);
}

void applyActiveMachineTiming(Runtime& runtime, i64 cpuHz) {
	const MachineManifest& manifest = EngineCore::instance().machineManifest();
	const int cycleBudget = calcCyclesPerFrame(cpuHz, runtime.timing.ufpsScaled);
	const i64 vblankCycles = resolveVblankCycles(cpuHz, runtime.timing.ufpsScaled, manifest.viewportHeight);
	setCpuHz(runtime, cpuHz);
	setCycleBudgetPerFrame(runtime, cycleBudget);
	runtime.vblank.setVblankCycles(runtime, static_cast<int>(vblankCycles));
	setVdpWorkUnitsPerSec(runtime, resolvePositiveWorkUnits(manifest.vdpWorkUnitsPerSec.value_or(DEFAULT_VDP_WORK_UNITS_PER_SEC), "work_units_per_sec"));
	setGeoWorkUnitsPerSec(runtime, resolvePositiveWorkUnits(manifest.geoWorkUnitsPerSec.value_or(DEFAULT_GEO_WORK_UNITS_PER_SEC), "geo_work_units_per_sec"));
}

} // namespace bmsx
