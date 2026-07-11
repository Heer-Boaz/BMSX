import type { Runtime } from '../runtime';

export type RuntimeTransferRates = {
	dmaBytesPerSec: number;
	geoWorkUnitsPerSec: number;
};

export function refreshDeviceTimings(runtime: Runtime, nowCycles: number): void {
	runtime.machine.refreshDeviceTimings({
		cpuHz: runtime.timing.cpuHz,
		dmaBytesPerSec: runtime.timing.dmaBytesPerSec,
		geoWorkUnitsPerSec: runtime.timing.geoWorkUnitsPerSec,
	}, nowCycles);
}

export function setCycleBudgetPerFrame(runtime: Runtime, value: number): void {
	const timing = runtime.timing;
	if (value === timing.cycleBudgetPerFrame) {
		return;
	}
	timing.cycleBudgetPerFrame = value;
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
	runtime.vblank.configureCycleBudget();
}

export function setFrameTiming(runtime: Runtime, cpuHz: number, cycleBudgetPerFrame: number, vblankCycles: number): void {
	const timing = runtime.timing;
	timing.cpuHz = cpuHz;
	if (cycleBudgetPerFrame !== timing.cycleBudgetPerFrame) {
		timing.cycleBudgetPerFrame = cycleBudgetPerFrame;
	}
	runtime.vblank.setVblankCycles(vblankCycles);
}

export function setTransferRates(runtime: Runtime, rates: RuntimeTransferRates): void {
	runtime.timing.dmaBytesPerSec = rates.dmaBytesPerSec;
	runtime.timing.geoWorkUnitsPerSec = rates.geoWorkUnitsPerSec;
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
}
