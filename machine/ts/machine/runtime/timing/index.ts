import { HZ_SCALE } from '../../../spec/bmsx/timing';

export function calcCyclesPerFrameScaled(cpuHz: number, refreshHzScaled: number): number {
	const cpuRemainder = cpuHz % refreshHzScaled;
	const whole = (cpuHz - cpuRemainder) / refreshHzScaled * HZ_SCALE;
	const scaledRemainder = cpuRemainder * HZ_SCALE;
	const remainder = (scaledRemainder - scaledRemainder % refreshHzScaled) / refreshHzScaled;
	return whole + remainder;
}
