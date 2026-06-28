import type { MachineManifest } from '../../rompack/format';
import { getMachinePerfSpecs } from '../../rompack/format';
import type { Runtime } from './runtime';
import { resolveCpuHz, resolvePositiveSafeInteger, resolveRuntimeRenderSize, resolveUfpsScaled } from '../specs';
import { calcCyclesPerFrameScaled, resolveVblankCycles } from './timing';
import { setFrameTiming, setTransferRatesFromManifest } from './timing/config';

export type ResolvedRuntimeTiming = {
	viewportWidth: number;
	viewportHeight: number;
	ufpsScaled: number;
	cpuHz: number;
	imgDecBytesPerSec: number;
	dmaBytesPerSecIso: number;
	dmaBytesPerSecBulk: number;
	vdpWorkUnitsPerSec: number;
	geoWorkUnitsPerSec: number;
	cycleBudgetPerFrame: number;
	vblankCycles: number;
};

export function resolveRuntimeTiming(machine: MachineManifest): ResolvedRuntimeTiming;
export function resolveRuntimeTiming(viewportMachine: MachineManifest, timingMachine: MachineManifest, cpuHz: number, ufpsScaled: number): ResolvedRuntimeTiming;
export function resolveRuntimeTiming(
	viewportMachine: MachineManifest,
	timingMachine: MachineManifest = viewportMachine,
	cpuHz = resolveCpuHz(timingMachine),
	ufpsScaled = resolveUfpsScaled(timingMachine),
): ResolvedRuntimeTiming {
	const renderSize = resolveRuntimeRenderSize(viewportMachine);
	const perfSpecs = getMachinePerfSpecs(timingMachine);
	return {
		viewportWidth: renderSize.width,
		viewportHeight: renderSize.height,
		ufpsScaled,
		cpuHz,
		imgDecBytesPerSec: resolvePositiveSafeInteger(perfSpecs.imgdec_bytes_per_sec, 'machine.specs.cpu.imgdec_bytes_per_sec'),
		dmaBytesPerSecIso: resolvePositiveSafeInteger(perfSpecs.dma_bytes_per_sec_iso, 'machine.specs.dma.dma_bytes_per_sec_iso'),
		dmaBytesPerSecBulk: resolvePositiveSafeInteger(perfSpecs.dma_bytes_per_sec_bulk, 'machine.specs.dma.dma_bytes_per_sec_bulk'),
		vdpWorkUnitsPerSec: resolvePositiveSafeInteger(perfSpecs.work_units_per_sec, 'machine.specs.vdp.work_units_per_sec'),
		geoWorkUnitsPerSec: resolvePositiveSafeInteger(perfSpecs.geo_work_units_per_sec, 'machine.specs.geo.work_units_per_sec'),
		cycleBudgetPerFrame: calcCyclesPerFrameScaled(cpuHz, ufpsScaled),
		vblankCycles: resolveVblankCycles(cpuHz, ufpsScaled, timingMachine.render_size.height),
	};
}

export function applyRuntimeTiming(runtime: Runtime, timing: ResolvedRuntimeTiming): void {
	runtime.applyUfpsScaled(timing.ufpsScaled);
	setFrameTiming(runtime, timing.cpuHz, timing.cycleBudgetPerFrame, timing.vblankCycles);
	setTransferRatesFromManifest(runtime, {
		imgdec_bytes_per_sec: timing.imgDecBytesPerSec,
		dma_bytes_per_sec_iso: timing.dmaBytesPerSecIso,
		dma_bytes_per_sec_bulk: timing.dmaBytesPerSecBulk,
		work_units_per_sec: timing.vdpWorkUnitsPerSec,
		geo_work_units_per_sec: timing.geoWorkUnitsPerSec,
	});
}
