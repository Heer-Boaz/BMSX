#include "machine/runtime/timing/config.h"

#include "machine/runtime/runtime.h"

namespace bmsx {

void refreshDeviceTimings(Runtime& runtime, i64 nowCycles) {
	const MachineTiming machineTiming{
		runtime.timing.cpuHz,
		runtime.timing.dmaWordsPerSec,
		runtime.timing.dmaRamRowReopenCycles,
		runtime.timing.dmaRomWaitCyclesPerWord,
		runtime.timing.geoWorkUnitsPerSec,
	};
	runtime.machine.refreshDeviceTimings(machineTiming, nowCycles);
}

void setCycleBudgetPerFrame(Runtime& runtime, i64 value) {
	if (value == runtime.timing.cycleBudgetPerFrame) {
		return;
	}
	runtime.timing.cycleBudgetPerFrame = value;
}

void setFrameTiming(Runtime& runtime, i64 cpuHz, i64 cycleBudgetPerFrame) {
	runtime.timing.cpuHz = cpuHz;
	runtime.timing.cpuCyclesPerMillisecond = static_cast<f64>(cpuHz) / 1000.0;
	if (cycleBudgetPerFrame != runtime.timing.cycleBudgetPerFrame) {
		runtime.timing.cycleBudgetPerFrame = cycleBudgetPerFrame;
	}
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
}

void setTransferRates(Runtime& runtime, const RuntimeTransferRates& rates) {
	runtime.timing.dmaWordsPerSec = rates.dmaWordsPerSec;
	runtime.timing.dmaRamRowReopenCycles = rates.dmaRamRowReopenCycles;
	runtime.timing.dmaRomWaitCyclesPerWord = rates.dmaRomWaitCyclesPerWord;
	runtime.timing.geoWorkUnitsPerSec = rates.geoWorkUnitsPerSec;
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
}

} // namespace bmsx
