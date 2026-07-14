#include "machine/runtime/timing/config.h"

#include "machine/runtime/runtime.h"

namespace bmsx {

void refreshDeviceTimings(Runtime& runtime, i64 nowCycles) {
	const MachineTiming machineTiming{
		runtime.timing.cpuHz,
		runtime.timing.dmaWordsPerSec,
		runtime.timing.geoWorkUnitsPerSec,
	};
	runtime.machine.refreshDeviceTimings(machineTiming, nowCycles);
}

void setCycleBudgetPerFrame(Runtime& runtime, int value) {
	if (value == runtime.timing.cycleBudgetPerFrame) {
		return;
	}
	runtime.timing.cycleBudgetPerFrame = value;
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
	runtime.vblank.configureCycleBudget(runtime);
}

void setFrameTiming(Runtime& runtime, i64 cpuHz, int cycleBudgetPerFrame, int vblankCycles) {
	runtime.timing.cpuHz = cpuHz;
	if (cycleBudgetPerFrame != runtime.timing.cycleBudgetPerFrame) {
		runtime.timing.cycleBudgetPerFrame = cycleBudgetPerFrame;
	}
	runtime.vblank.setVblankCycles(runtime, vblankCycles);
}

void setTransferRates(Runtime& runtime, const RuntimeTransferRates& rates) {
	runtime.timing.dmaWordsPerSec = rates.dmaWordsPerSec;
	runtime.timing.geoWorkUnitsPerSec = rates.geoWorkUnitsPerSec;
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
}

} // namespace bmsx
