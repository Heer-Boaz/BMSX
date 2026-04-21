import { $ } from '../../core/engine';
import { getMachinePerfSpecs } from '../../rompack/format';
import { calcCyclesPerFrameScaled, resolveVblankCycles } from './timing';
import { resolveBytesPerSec, resolveGeoWorkUnitsPerSec, resolveRuntimeRenderSize, resolveVdpWorkUnitsPerSec } from '../specs';
import type { Runtime } from './runtime';

export type TransferRateManifest = {
	imgdec_bytes_per_sec: number;
	dma_bytes_per_sec_iso: number;
	dma_bytes_per_sec_bulk: number;
	work_units_per_sec: number;
	geo_work_units_per_sec: number;
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
	runtime.machine.cpu.setGlobalByKey(runtime.luaKey('sys_max_cycles_per_frame'), value);
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
	runtime.vblank.configureCycleBudget(runtime);
}

export function setCpuHz(runtime: Runtime, value: number): void {
	runtime.timing.cpuHz = value;
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
}

export function setVdpWorkUnitsPerSec(runtime: Runtime, value: number): void {
	const workUnitsPerSec = resolveVdpWorkUnitsPerSec(value);
	runtime.timing.vdpWorkUnitsPerSec = workUnitsPerSec;
	runtime.machine.vdp.setTiming(runtime.timing.cpuHz, workUnitsPerSec, runtime.machine.scheduler.currentNowCycles());
}

export function setGeoWorkUnitsPerSec(runtime: Runtime, value: number): void {
	const workUnitsPerSec = resolveGeoWorkUnitsPerSec(value);
	runtime.timing.geoWorkUnitsPerSec = workUnitsPerSec;
	runtime.machine.geometryController.setTiming(runtime.timing.cpuHz, workUnitsPerSec, runtime.machine.scheduler.currentNowCycles());
}

export function applyActiveMachineTiming(runtime: Runtime, cpuHz: number): void {
	const perfSpecs = getMachinePerfSpecs($.machine_manifest);
	const ufpsScaled = runtime.timing.ufpsScaled;
	const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuHz, ufpsScaled);
	const renderSize = resolveRuntimeRenderSize($.machine_manifest);
	const vblankCycles = resolveVblankCycles(cpuHz, ufpsScaled, renderSize.height);
	setCpuHz(runtime, cpuHz);
	setCycleBudgetPerFrame(runtime, cycleBudgetPerFrame);
	runtime.vblank.setVblankCycles(runtime, vblankCycles);
	setVdpWorkUnitsPerSec(runtime, perfSpecs.work_units_per_sec);
	setGeoWorkUnitsPerSec(runtime, perfSpecs.geo_work_units_per_sec);
}

export function setTransferRatesFromManifest(runtime: Runtime, specs: TransferRateManifest): void {
	runtime.timing.imgDecBytesPerSec = resolveBytesPerSec(specs.imgdec_bytes_per_sec, 'machine.specs.cpu.imgdec_bytes_per_sec');
	runtime.timing.dmaBytesPerSecIso = resolveBytesPerSec(specs.dma_bytes_per_sec_iso, 'machine.specs.dma.dma_bytes_per_sec_iso');
	runtime.timing.dmaBytesPerSecBulk = resolveBytesPerSec(specs.dma_bytes_per_sec_bulk, 'machine.specs.dma.dma_bytes_per_sec_bulk');
	setVdpWorkUnitsPerSec(runtime, specs.work_units_per_sec);
	setGeoWorkUnitsPerSec(runtime, specs.geo_work_units_per_sec);
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
}
