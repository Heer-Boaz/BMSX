#include "machine/runtime/timing/config.h"

#include "machine/runtime/runtime.h"
#include "machine/specs.h"

namespace bmsx {

void refreshDeviceTimings(Runtime& runtime, i64 nowCycles) {
	const MachineTiming machineTiming{
		runtime.timing.cpuHz,
		runtime.timing.dmaBytesPerSecIso,
		runtime.timing.dmaBytesPerSecBulk,
		runtime.timing.imgDecBytesPerSec,
		runtime.timing.geoWorkUnitsPerSec,
		runtime.timing.vdpWorkUnitsPerSec,
	};
	runtime.machine.refreshDeviceTimings(machineTiming, nowCycles);
}

void setCycleBudgetPerFrame(Runtime& runtime, int value) {
	if (value == runtime.timing.cycleBudgetPerFrame) {
		return;
	}
	runtime.timing.cycleBudgetPerFrame = value;
	runtime.setGlobal("sys_max_cycles_per_frame", valueNumber(static_cast<double>(value)));
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
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

void setTransferRatesFromManifest(Runtime& runtime, const RuntimeTransferRates& specs) {
	runtime.timing.imgDecBytesPerSec = specs.imgDecBytesPerSec;
	runtime.timing.dmaBytesPerSecIso = specs.dmaBytesPerSecIso;
	runtime.timing.dmaBytesPerSecBulk = specs.dmaBytesPerSecBulk;
	runtime.timing.vdpWorkUnitsPerSec = static_cast<int>(resolvePositiveSafeInteger(specs.vdpWorkUnitsPerSec, "machine.specs.vdp.work_units_per_sec"));
	runtime.timing.geoWorkUnitsPerSec = static_cast<int>(resolvePositiveSafeInteger(specs.geoWorkUnitsPerSec, "machine.specs.geo.work_units_per_sec"));
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
}

} // namespace bmsx
