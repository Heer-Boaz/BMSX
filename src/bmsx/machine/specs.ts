import type { Viewport } from '../rompack/format';

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

export function resolveRuntimeRenderSize(machine: { render_size: { width: number; height: number; } }): Viewport {
	const width = resolvePositiveSafeInteger(machine.render_size.width, 'machine.render_size.width');
	const height = resolvePositiveSafeInteger(machine.render_size.height, 'machine.render_size.height');
	return { width, height };
}
