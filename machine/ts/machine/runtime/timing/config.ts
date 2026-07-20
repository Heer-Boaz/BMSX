import type { Runtime } from '../runtime';

export type RuntimeTransferRates = {
	dmaWordsPerSec: number;
	dmaRamRowReopenCycles: number;
	dmaRomWaitCyclesPerWord: number;
	geoWorkUnitsPerSec: number;
};

export function refreshDeviceTimings(runtime: Runtime, nowCycles: number): void {
	runtime.machine.refreshDeviceTimings({
		cpuHz: runtime.timing.cpuHz,
		dmaWordsPerSec: runtime.timing.dmaWordsPerSec,
		dmaRamRowReopenCycles: runtime.timing.dmaRamRowReopenCycles,
		dmaRomWaitCyclesPerWord: runtime.timing.dmaRomWaitCyclesPerWord,
		geoWorkUnitsPerSec: runtime.timing.geoWorkUnitsPerSec,
	}, nowCycles);
}

export function setCycleBudgetPerFrame(runtime: Runtime, value: number): void {
	const timing = runtime.timing;
	if (value === timing.cycleBudgetPerFrame) {
		return;
	}
	timing.cycleBudgetPerFrame = value;
}

export function setFrameTiming(runtime: Runtime, cpuHz: number, cycleBudgetPerFrame: number): void {
	const timing = runtime.timing;
	timing.cpuHz = cpuHz;
	timing.cpuCyclesPerMillisecond = cpuHz / 1000;
	if (cycleBudgetPerFrame !== timing.cycleBudgetPerFrame) {
		timing.cycleBudgetPerFrame = cycleBudgetPerFrame;
	}
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
}

export function setTransferRates(runtime: Runtime, rates: RuntimeTransferRates): void {
	runtime.timing.dmaWordsPerSec = rates.dmaWordsPerSec;
	runtime.timing.dmaRamRowReopenCycles = rates.dmaRamRowReopenCycles;
	runtime.timing.dmaRomWaitCyclesPerWord = rates.dmaRomWaitCyclesPerWord;
	runtime.timing.geoWorkUnitsPerSec = rates.geoWorkUnitsPerSec;
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
}
