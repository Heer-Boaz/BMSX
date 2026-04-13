import { $ } from '../core/engine_core';
import { HZ_SCALE } from '../platform/platform';

export function calcCyclesPerFrameScaled(cpuHz: number, refreshHzScaled: number): number {
	if (!Number.isSafeInteger(cpuHz) || cpuHz <= 0) {
		throw new Error('[RuntimeTiming] cpuHz must be a positive safe integer.');
	}
	if (!Number.isSafeInteger(refreshHzScaled) || refreshHzScaled <= 0) {
		throw new Error('[RuntimeTiming] refreshHzScaled must be a positive safe integer.');
	}
	const wholeCycles = Math.floor(cpuHz / refreshHzScaled) * HZ_SCALE;
	const remainderCycles = Math.floor((cpuHz % refreshHzScaled) * HZ_SCALE / refreshHzScaled);
	const cyclesPerFrame = wholeCycles + remainderCycles;
	if (!Number.isSafeInteger(cyclesPerFrame) || cyclesPerFrame <= 0) {
		throw new Error('[RuntimeTiming] cycles per frame must be a positive safe integer.');
	}
	return cyclesPerFrame;
}

export function resolveVblankCycles(cpuFreqHz: number, ufpsScaled: number, renderHeight: number): number {
	if (!Number.isSafeInteger(cpuFreqHz) || cpuFreqHz <= 0) {
		throw new Error('[RuntimeTiming] cpuFreqHz must be a positive safe integer.');
	}
	if (!Number.isSafeInteger(ufpsScaled) || ufpsScaled <= 0) {
		throw new Error('[RuntimeTiming] ufpsScaled must be a positive safe integer.');
	}
	if (!Number.isSafeInteger(renderHeight) || renderHeight <= 0) {
		throw new Error('[RuntimeTiming] renderHeight must be a positive safe integer.');
	}
	const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuFreqHz, ufpsScaled);
	const activeScanlines = Math.floor(cycleBudgetPerFrame / (renderHeight + 1));
	const activeDisplayCycles = activeScanlines * renderHeight;
	const vblankCycles = cycleBudgetPerFrame - activeDisplayCycles;
	if (!Number.isSafeInteger(vblankCycles) || vblankCycles < 0 || vblankCycles > cycleBudgetPerFrame) {
		throw new Error('[RuntimeTiming] invalid vblank cycle configuration.');
	}
	return vblankCycles;
}

export function resolveUfpsScaled(value: number | undefined): number {
	if (value === undefined) {
		throw new Error('[RuntimeTiming] machine.ufps is required.');
	}
	if (!Number.isSafeInteger(value) || value <= HZ_SCALE) {
		throw new Error('[RuntimeTiming] machine.ufps must be a safe integer greater than 1 Hz.');
	}
	return value;
}

export class RuntimeTimingState {
	public ufpsScaled = 0;
	public targetFps = 0;
	public frameDurationMs = 0;

	constructor(ufpsScaled: number) {
		this.applyUfpsScaled(ufpsScaled);
	}

	public get ufps(): number {
		return this.targetFps;
	}

	public applyUfpsScaled(ufpsScaled: number): void {
		this.ufpsScaled = resolveUfpsScaled(ufpsScaled);
		this.targetFps = this.ufpsScaled / HZ_SCALE;
		this.frameDurationMs = 1000 / this.targetFps;
		$.platform.audio.setFrameTimeSec(HZ_SCALE / this.ufpsScaled);
		$.sndmaster.setMixerFps(this.targetFps);
	}

	public resolveCycleBudget(cpuHz: number): number {
		return calcCyclesPerFrameScaled(cpuHz, this.ufpsScaled);
	}

	public resolveVblankCycles(cpuHz: number, renderHeight: number): number {
		return resolveVblankCycles(cpuHz, this.ufpsScaled, renderHeight);
	}
}
