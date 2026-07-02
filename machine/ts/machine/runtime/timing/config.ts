import type { Runtime } from '../runtime';

export type RuntimeTransferRates = {
	imgDecBytesPerSec: number;
	dmaBytesPerSecIso: number;
	dmaBytesPerSecBulk: number;
	vdpWorkUnitsPerSec: number;
	geoWorkUnitsPerSec: number;
};

export function refreshDeviceTimings(runtime: Runtime, nowCycles: number): void {
	runtime.machine.refreshDeviceTimings({
		cpuHz: runtime.timing.cpuHz,
		dmaBytesPerSecIso: runtime.timing.dmaBytesPerSecIso,
		dmaBytesPerSecBulk: runtime.timing.dmaBytesPerSecBulk,
		imgDecBytesPerSec: runtime.timing.imgDecBytesPerSec,
		geoWorkUnitsPerSec: runtime.timing.geoWorkUnitsPerSec,
		vdpWorkUnitsPerSec: runtime.timing.vdpWorkUnitsPerSec,
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
	runtime.timing.imgDecBytesPerSec = rates.imgDecBytesPerSec;
	runtime.timing.dmaBytesPerSecIso = rates.dmaBytesPerSecIso;
	runtime.timing.dmaBytesPerSecBulk = rates.dmaBytesPerSecBulk;
	runtime.timing.vdpWorkUnitsPerSec = rates.vdpWorkUnitsPerSec;
	runtime.timing.geoWorkUnitsPerSec = rates.geoWorkUnitsPerSec;
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
}
