import { HZ_SCALE } from './constants';

function floorScaledRatio(value: number, multiplier: number, divisor: number): number {
	const whole = Math.trunc(value / divisor) * multiplier;
	const remainder = Math.trunc((value % divisor) * multiplier / divisor);
	return whole + remainder;
}

export function calcCyclesPerFrameScaled(cpuHz: number, refreshHzScaled: number): number {
	return floorScaledRatio(cpuHz, HZ_SCALE, refreshHzScaled);
}

export function resolveVblankCycles(cpuFreqHz: number, ufpsScaled: number, totalScanlines: number, renderHeight: number): number {
	const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuFreqHz, ufpsScaled);
	const activeDisplayCycles = floorScaledRatio(cycleBudgetPerFrame, renderHeight, totalScanlines);
	return cycleBudgetPerFrame - activeDisplayCycles;
}
