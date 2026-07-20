import type { Runtime } from '../runtime';

export function refreshDeviceTimings(runtime: Runtime, nowCycles: number): void {
	runtime.machine.refreshDeviceTimings({
		cpuHz: runtime.timing.cpuHz,
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
