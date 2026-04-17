import type { Viewport } from '../../rompack/rompack';

function runtimeSpecFault(message: string): Error {
	return new Error(`Runtime fault: ${message}`);
}

export function resolvePositiveSafeInteger(value: number | undefined, label: string): number {
	if (value === undefined) {
		throw runtimeSpecFault(`${label} is required.`);
	}
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw runtimeSpecFault(`${label} must be a positive safe integer.`);
	}
	return value;
}

export function resolveCpuHz(value: number | undefined): number {
	return resolvePositiveSafeInteger(value, 'machine.specs.cpu.cpu_freq_hz');
}

export function resolveBytesPerSec(value: number | undefined, label: string): number {
	return resolvePositiveSafeInteger(value, label);
}

export function resolveVdpWorkUnitsPerSec(value: number | undefined): number {
	return resolvePositiveSafeInteger(value, 'machine.specs.vdp.work_units_per_sec');
}

export function resolveGeoWorkUnitsPerSec(value: number | undefined): number {
	return resolvePositiveSafeInteger(value, 'machine.specs.geo.work_units_per_sec');
}

export function resolveRuntimeRenderSize(machine: { render_size: { width: number; height: number; } }): Viewport {
	const width = resolvePositiveSafeInteger(machine.render_size.width, 'machine.render_size.width');
	const height = resolvePositiveSafeInteger(machine.render_size.height, 'machine.render_size.height');
	return { width, height };
}
