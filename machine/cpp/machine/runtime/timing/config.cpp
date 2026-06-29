#include "machine/runtime/timing/config.h"

#include "machine/runtime/runtime.h"

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

void setTransferRates(Runtime& runtime, const RuntimeTransferRates& rates) {
	runtime.timing.imgDecBytesPerSec = rates.imgDecBytesPerSec;
	runtime.timing.dmaBytesPerSecIso = rates.dmaBytesPerSecIso;
	runtime.timing.dmaBytesPerSecBulk = rates.dmaBytesPerSecBulk;
	runtime.timing.vdpWorkUnitsPerSec = rates.vdpWorkUnitsPerSec;
	runtime.timing.geoWorkUnitsPerSec = rates.geoWorkUnitsPerSec;
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
}

} // namespace bmsx
