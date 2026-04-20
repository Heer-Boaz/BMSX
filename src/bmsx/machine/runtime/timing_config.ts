import { $ } from '../../core/engine';
import { getMachinePerfSpecs } from '../../rompack/format';
import { calcCyclesPerFrameScaled, resolveVblankCycles } from './timing';
import { resolvePositiveSafeInteger, resolveRuntimeRenderSize } from '../specs';
import type { Runtime } from './runtime';

export type TransferRateManifest = {
	imgdec_bytes_per_sec: number;
	dma_bytes_per_sec_iso: number;
	dma_bytes_per_sec_bulk: number;
	work_units_per_sec: number;
	geo_work_units_per_sec: number;
};

export function setCycleBudgetPerFrame(runtime: Runtime, value: number): void {
	if (value === runtime.timing.cycleBudgetPerFrame) {
		return;
	}
	setCycleBudget(runtime, value);
}

export function setCpuHz(runtime: Runtime, value: number): void {
	if (value === runtime.timing.cpuHz) {
		return;
	}
	runtime.timing.cpuHz = value;
	updateDeviceTimings(runtime);
}

export function applyActiveMachineTiming(runtime: Runtime, cpuHz: number): void {
	const perfSpecs = getMachinePerfSpecs($.machine_manifest);
	const ufpsScaled = runtime.timing.ufpsScaled;
	setCpuHz(runtime, cpuHz);
	setCycleBudgetPerFrame(runtime, calcCyclesPerFrameScaled(cpuHz, ufpsScaled));
	runtime.vblank.setVblankCycles(runtime, resolveVblankCycles(cpuHz, ufpsScaled, resolveRuntimeRenderSize($.machine_manifest).height));
	setWorkUnitsPerSec(
		runtime,
		perfSpecs.work_units_per_sec,
		'machine.specs.vdp.work_units_per_sec',
		runtime.machine.vdp.setTiming.bind(runtime.machine.vdp),
	);
	setWorkUnitsPerSec(
		runtime,
		perfSpecs.geo_work_units_per_sec,
		'machine.specs.geo.work_units_per_sec',
		runtime.machine.geometryController.setTiming.bind(runtime.machine.geometryController),
	);
}

export function setTransferRatesFromManifest(runtime: Runtime, specs: TransferRateManifest): void {
	runtime.timing.imgDecBytesPerSec = resolvePositiveSafeInteger(specs.imgdec_bytes_per_sec, 'machine.specs.cpu.imgdec_bytes_per_sec');
	runtime.timing.dmaBytesPerSecIso = resolvePositiveSafeInteger(specs.dma_bytes_per_sec_iso, 'machine.specs.dma.dma_bytes_per_sec_iso');
	runtime.timing.dmaBytesPerSecBulk = resolvePositiveSafeInteger(specs.dma_bytes_per_sec_bulk, 'machine.specs.dma.dma_bytes_per_sec_bulk');
	setWorkUnitsPerSec(
		runtime,
		specs.work_units_per_sec,
		'machine.specs.vdp.work_units_per_sec',
		runtime.machine.vdp.setTiming.bind(runtime.machine.vdp),
	);
	setWorkUnitsPerSec(
		runtime,
		specs.geo_work_units_per_sec,
		'machine.specs.geo.work_units_per_sec',
		runtime.machine.geometryController.setTiming.bind(runtime.machine.geometryController),
	);
	updateDeviceTimings(runtime);
}

function setWorkUnitsPerSec(
	runtime: Runtime,
	value: number,
	name: string,
	setTiming: (cpuHz: number, workUnitsPerSec: number, nowCycles: number) => void,
): void {
	const workUnitsPerSec = resolvePositiveSafeInteger(value, name);
	if (name === 'machine.specs.vdp.work_units_per_sec') {
		runtime.timing.vdpWorkUnitsPerSec = workUnitsPerSec;
	} else {
		runtime.timing.geoWorkUnitsPerSec = workUnitsPerSec;
	}
	setTiming(runtime.timing.cpuHz, workUnitsPerSec, runtime.machine.scheduler.currentNowCycles());
}

function setCycleBudget(runtime: Runtime, value: number): void {
	runtime.timing.cycleBudgetPerFrame = value;
	runtime.machine.cpu.setGlobalByKey(runtime.luaKey('sys_max_cycles_per_frame'), value);
	updateDeviceTimings(runtime);
	runtime.vblank.configureCycleBudget(runtime);
}

function updateDeviceTimings(runtime: Runtime): void {
	if (runtime.machine) {
		runtime.machine.refreshDeviceTimings(
			{
				cpuHz: runtime.timing.cpuHz,
				dmaBytesPerSecIso: runtime.timing.dmaBytesPerSecIso,
				dmaBytesPerSecBulk: runtime.timing.dmaBytesPerSecBulk,
				imgDecBytesPerSec: runtime.timing.imgDecBytesPerSec,
				geoWorkUnitsPerSec: runtime.timing.geoWorkUnitsPerSec,
				vdpWorkUnitsPerSec: runtime.timing.vdpWorkUnitsPerSec,
			},
			runtime.machine.scheduler.currentNowCycles(),
		);
	}
}
