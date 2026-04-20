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

void setVdpWorkUnitsPerSec(Runtime& runtime, int value) {
	runtime.timing.vdpWorkUnitsPerSec = resolvePositiveWorkUnits(value, "work_units_per_sec");
	runtime.machine().vdp().setTiming(runtime.timing.cpuHz, runtime.timing.vdpWorkUnitsPerSec, runtime.machine().scheduler().currentNowCycles());
}

void setGeoWorkUnitsPerSec(Runtime& runtime, int value) {
	runtime.timing.geoWorkUnitsPerSec = resolvePositiveWorkUnits(value, "geo_work_units_per_sec");
	runtime.machine().geometryController().setTiming(runtime.timing.cpuHz, runtime.timing.geoWorkUnitsPerSec, runtime.machine().scheduler().currentNowCycles());
}

void setTransferRatesFromManifest(Runtime& runtime, const RuntimeTransferRates& rates) {
	runtime.timing.imgDecBytesPerSec = rates.imgDecBytesPerSec;
	runtime.timing.dmaBytesPerSecIso = rates.dmaBytesPerSecIso;
	runtime.timing.dmaBytesPerSecBulk = rates.dmaBytesPerSecBulk;
	setVdpWorkUnitsPerSec(runtime, rates.vdpWorkUnitsPerSec);
	setGeoWorkUnitsPerSec(runtime, rates.geoWorkUnitsPerSec);
	refreshDeviceTimings(runtime, runtime.machine().scheduler().currentNowCycles());
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
