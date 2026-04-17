import { $ } from '../../core/engine_core';
import { getMachinePerfSpecs } from '../../rompack/rompack';
import { calcCyclesPerFrameScaled, resolveVblankCycles } from './runtime_timing';
import { resolveBytesPerSec, resolveGeoWorkUnitsPerSec, resolveRuntimeRenderSize, resolveVdpWorkUnitsPerSec } from '../machine_specs';
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
	if (value === runtime.timing.cycleBudgetPerFrame) {
		return;
	}
	runtime.timing.cycleBudgetPerFrame = value;
	runtime.machine.cpu.setGlobalByKey(runtime.canonicalKey('sys_max_cycles_per_frame'), value);
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
	runtime.vblank.configureCycleBudget(runtime);
}

export function setCpuHz(runtime: Runtime, value: number): void {
	runtime.timing.cpuHz = value;
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
}

export function setVdpWorkUnitsPerSec(runtime: Runtime, value: number): void {
	runtime.timing.vdpWorkUnitsPerSec = resolveVdpWorkUnitsPerSec(value);
	runtime.machine.vdp.setTiming(runtime.timing.cpuHz, runtime.timing.vdpWorkUnitsPerSec, runtime.machine.scheduler.currentNowCycles());
}

export function setGeoWorkUnitsPerSec(runtime: Runtime, value: number): void {
	runtime.timing.geoWorkUnitsPerSec = resolveGeoWorkUnitsPerSec(value);
	runtime.machine.geometryController.setTiming(runtime.timing.cpuHz, runtime.timing.geoWorkUnitsPerSec, runtime.machine.scheduler.currentNowCycles());
}

export function applyActiveMachineTiming(runtime: Runtime, cpuHz: number): void {
	const perfSpecs = getMachinePerfSpecs($.machine_manifest);
	const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuHz, runtime.timing.ufpsScaled);
	const renderSize = resolveRuntimeRenderSize($.machine_manifest);
	const vblankCycles = resolveVblankCycles(cpuHz, runtime.timing.ufpsScaled, renderSize.height);
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
