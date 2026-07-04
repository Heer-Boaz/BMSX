import { HZ_SCALE } from './constants';

export function calcCyclesPerFrameScaled(cpuHz: number, refreshHzScaled: number): number {
	const whole = Math.trunc(cpuHz / refreshHzScaled) * HZ_SCALE;
	const remainder = Math.trunc((cpuHz % refreshHzScaled) * HZ_SCALE / refreshHzScaled);
	return whole + remainder;
}

export function resolveVblankCycles(cpuFreqHz: number, ufpsScaled: number, totalScanlines: number, renderHeight: number): number {
	const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuFreqHz, ufpsScaled);
	const whole = Math.trunc(cycleBudgetPerFrame / totalScanlines) * renderHeight;
	const remainder = Math.trunc((cycleBudgetPerFrame % totalScanlines) * renderHeight / totalScanlines);
	return cycleBudgetPerFrame - (whole + remainder);
}
