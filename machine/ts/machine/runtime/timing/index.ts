import { HZ_SCALE } from './constants';

const PAL_TOTAL_SCANLINES = 313;
const NTSC_TOTAL_SCANLINES = 262;
const PAL_NTSC_REFRESH_CUTOFF_SCALED = 55 * HZ_SCALE;

function floorScaledRatio(value: number, multiplier: number, divisor: number): number {
	const whole = Math.trunc(value / divisor) * multiplier;
	const remainder = Math.trunc((value % divisor) * multiplier / divisor);
	return whole + remainder;
}

export function calcCyclesPerFrameScaled(cpuHz: number, refreshHzScaled: number): number {
	return floorScaledRatio(cpuHz, HZ_SCALE, refreshHzScaled);
}

export function resolveTotalScanlines(refreshHzScaled: number): number {
	return refreshHzScaled <= PAL_NTSC_REFRESH_CUTOFF_SCALED ? PAL_TOTAL_SCANLINES : NTSC_TOTAL_SCANLINES;
}

export function resolveVblankCycles(cpuFreqHz: number, ufpsScaled: number, renderHeight: number): number {
	const cycleBudgetPerFrame = calcCyclesPerFrameScaled(cpuFreqHz, ufpsScaled);
	const totalScanlines = resolveTotalScanlines(ufpsScaled);
	// BMSX derives VBLANK from a simplified CRT scanline model instead of a manifest override.
	// 50 Hz class machines are treated as PAL-like 313-line frames, and faster refresh rates as
	// NTSC-like 262-line frames. This came from checking that the old renderHeight + 1 formula gave
	// Pietious at 5 MHz/50 Hz only 544 VBLANK cycles, effectively a one-scanline frame edge. The
	// scanline ratio gives floor(100000 * 192 / 313) visible cycles and 38659 VBLANK cycles, which
	// keeps the cart refresh at 50/60 Hz while allowing MSX/Konami-style 25/30 Hz game ticks in cart code.
	const activeDisplayCycles = floorScaledRatio(cycleBudgetPerFrame, renderHeight, totalScanlines);
	return cycleBudgetPerFrame - activeDisplayCycles;
}
