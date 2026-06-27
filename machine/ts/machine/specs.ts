import { getMachinePerfSpecs, type MachineManifest, type Viewport } from '../rompack/format';
import { HZ_SCALE } from './runtime/timing/constants';

const CPU_HZ_MISSING_MESSAGE = '[RuntimeMachineSpecs] machine.specs.cpu.cpu_freq_hz is required.';
const CPU_HZ_INVALID_MESSAGE = '[RuntimeMachineSpecs] machine.specs.cpu.cpu_freq_hz must be a positive integer.';
const UFPS_MISSING_MESSAGE = '[RuntimeMachineSpecs] machine.ufps is required.';
const UFPS_INVALID_MESSAGE = '[RuntimeMachineSpecs] machine.ufps must be greater than 1 Hz.';

export type ResolvedManifestNumber = { value: number };

type ManifestNumberPredicate = (value: number) => boolean;

function resolveValue(value: number | undefined, out: ResolvedManifestNumber, predicate: ManifestNumberPredicate): boolean {
	if (value === undefined || !predicate(value)) {
		return false;
	}
	out.value = value;
	return true;
}

export function requirePositiveManifestValue(value: number | undefined, missingMessage: string, invalidMessage: string): number {
	if (value === undefined) {
		throw new Error(missingMessage);
	}
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(invalidMessage);
	}
	return value;
}

export function resolvePositiveManifestValue(value: number | undefined, defaultValue: number, invalidMessage: string): number {
	const resolved = value === undefined ? defaultValue : value;
	if (!Number.isSafeInteger(resolved) || resolved <= 0) {
		throw new Error(invalidMessage);
	}
	return resolved;
}

export function requireManifestValueAbove(value: number | undefined, minimumExclusive: number, missingMessage: string, invalidMessage: string): number {
	if (value === undefined) {
		throw new Error(missingMessage);
	}
	if (!Number.isSafeInteger(value) || value <= minimumExclusive) {
		throw new Error(invalidMessage);
	}
	return value;
}

export function resolveCpuHz(machine: MachineManifest, outHz: ResolvedManifestNumber): boolean;
export function resolveCpuHz(machine: MachineManifest): number;
export function resolveCpuHz(machine: MachineManifest, outHz?: ResolvedManifestNumber): number | boolean {
	const value = getMachinePerfSpecs(machine).cpu_freq_hz;
	if (outHz !== undefined) {
		return resolveValue(value, outHz, hz => Number.isSafeInteger(hz) && hz > 0);
	}
	return requirePositiveManifestValue(value, CPU_HZ_MISSING_MESSAGE, CPU_HZ_INVALID_MESSAGE);
}

export function resolveUfpsScaled(machine: MachineManifest, outUfpsScaled: ResolvedManifestNumber): boolean;
export function resolveUfpsScaled(machine: MachineManifest): number;
export function resolveUfpsScaled(machine: MachineManifest, outUfpsScaled?: ResolvedManifestNumber): number | boolean {
	const value = getMachinePerfSpecs(machine).ufps;
	if (outUfpsScaled !== undefined) {
		return resolveValue(value, outUfpsScaled, ufpsScaled => Number.isSafeInteger(ufpsScaled) && ufpsScaled > HZ_SCALE);
	}
	return requireManifestValueAbove(value, HZ_SCALE, UFPS_MISSING_MESSAGE, UFPS_INVALID_MESSAGE);
}

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
