import { HZ_SCALE } from '../../platform/platform';

const PAL_TOTAL_SCANLINES = 313;
const NTSC_TOTAL_SCANLINES = 262;
const PAL_NTSC_REFRESH_CUTOFF_SCALED = 55 * HZ_SCALE;

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

export function resolveTotalScanlines(refreshHzScaled: number): number {
	if (!Number.isSafeInteger(refreshHzScaled) || refreshHzScaled <= 0) {
		throw new Error('[RuntimeTiming] refreshHzScaled must be a positive safe integer.');
	}
	return refreshHzScaled <= PAL_NTSC_REFRESH_CUTOFF_SCALED ? PAL_TOTAL_SCANLINES : NTSC_TOTAL_SCANLINES;
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
	const totalScanlines = resolveTotalScanlines(ufpsScaled);
	if (renderHeight >= totalScanlines) {
		throw new Error('[RuntimeTiming] renderHeight must be smaller than total scanlines.');
	}
	// BMSX derives VBLANK from a simplified CRT scanline model instead of a manifest override.
	// 50 Hz class machines are treated as PAL-like 313-line frames, and faster refresh rates as
	// NTSC-like 262-line frames. This came from checking that the old renderHeight + 1 formula gave
	// Pietious at 5 MHz/50 Hz only 544 VBLANK cycles, effectively a one-scanline frame edge. The
	// scanline ratio gives floor(100000 * 192 / 313) visible cycles and 38659 VBLANK cycles, which
	// keeps the cart refresh at 50/60 Hz while allowing MSX/Konami-style 25/30 Hz game ticks in cart code.
	const visibleWhole = Math.floor(cycleBudgetPerFrame / totalScanlines) * renderHeight;
	const visibleRemainder = Math.floor(((cycleBudgetPerFrame % totalScanlines) * renderHeight) / totalScanlines);
	const activeDisplayCycles = visibleWhole + visibleRemainder;
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
