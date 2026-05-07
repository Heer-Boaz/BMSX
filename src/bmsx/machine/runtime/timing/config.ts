import { getMachinePerfSpecs } from '../../../rompack/format';
import { Input } from '../../../input/manager';
import { calcCyclesPerFrameScaled, resolveVblankCycles } from './index';
import { resolveBytesPerSec, resolveGeoWorkUnitsPerSec, resolveRuntimeRenderSize, resolveVdpWorkUnitsPerSec } from '../../specs';
import type { Runtime } from '../runtime';

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
	runtime.machine.cpu.setGlobalByKey(runtime.internString('sys_max_cycles_per_frame'), value);
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
	runtime.vblank.configureCycleBudget();
}

export function setFrameTiming(runtime: Runtime, cpuHz: number, cycleBudgetPerFrame: number, vblankCycles: number): void {
	const timing = runtime.timing;
	timing.cpuHz = cpuHz;
	if (cycleBudgetPerFrame !== timing.cycleBudgetPerFrame) {
		timing.cycleBudgetPerFrame = cycleBudgetPerFrame;
		runtime.machine.cpu.setGlobalByKey(runtime.internString('sys_max_cycles_per_frame'), cycleBudgetPerFrame);
	}
	runtime.vblank.setVblankCycles(vblankCycles);
	Input.instance.setFrameDurationMs(timing.frameDurationMs);
}

function setRenderWorkUnitsPerSec(runtime: Runtime, vdpValue: number, geoValue: number): void {
	runtime.timing.vdpWorkUnitsPerSec = resolveVdpWorkUnitsPerSec(vdpValue);
	runtime.timing.geoWorkUnitsPerSec = resolveGeoWorkUnitsPerSec(geoValue);
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
}

export function applyActiveMachineTiming(runtime: Runtime, cpuHz: number): void {
	const perfSpecs = getMachinePerfSpecs(runtime.activeMachineManifest);
	const ufpsScaled = runtime.timing.ufpsScaled;
	const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuHz, ufpsScaled);
	const renderSize = resolveRuntimeRenderSize(runtime.activeMachineManifest);
	const vblankCycles = resolveVblankCycles(cpuHz, ufpsScaled, renderSize.height);
	setFrameTiming(runtime, cpuHz, cycleBudgetPerFrame, vblankCycles);
	setRenderWorkUnitsPerSec(runtime, perfSpecs.work_units_per_sec, perfSpecs.geo_work_units_per_sec);
}

export function setTransferRatesFromManifest(runtime: Runtime, specs: TransferRateManifest): void {
	runtime.timing.imgDecBytesPerSec = resolveBytesPerSec(specs.imgdec_bytes_per_sec, 'machine.specs.cpu.imgdec_bytes_per_sec');
	runtime.timing.dmaBytesPerSecIso = resolveBytesPerSec(specs.dma_bytes_per_sec_iso, 'machine.specs.dma.dma_bytes_per_sec_iso');
	runtime.timing.dmaBytesPerSecBulk = resolveBytesPerSec(specs.dma_bytes_per_sec_bulk, 'machine.specs.dma.dma_bytes_per_sec_bulk');
	runtime.timing.vdpWorkUnitsPerSec = resolveVdpWorkUnitsPerSec(specs.work_units_per_sec);
	runtime.timing.geoWorkUnitsPerSec = resolveGeoWorkUnitsPerSec(specs.geo_work_units_per_sec);
	refreshDeviceTimings(runtime, runtime.machine.scheduler.currentNowCycles());
}
