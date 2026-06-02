import { clamp } from '../../../common/clamp';

export type BiquadFilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'allpass' | 'peaking' | 'lowshelf' | 'highshelf';

export class BiquadFilterState {
	public enabled = false;
	public b0 = 1;
	public b1 = 0;
	public b2 = 0;
	public a1 = 0;
	public a2 = 0;
	public l1 = 0;
	public l2 = 0;
	public r1 = 0;
	public r2 = 0;
	public outputLeft = 0;
	public outputRight = 0;

	public reset(): void {
		this.enabled = false;
		this.b0 = 1;
		this.b1 = 0;
		this.b2 = 0;
		this.a1 = 0;
		this.a2 = 0;
		this.l1 = 0;
		this.l2 = 0;
		this.r1 = 0;
		this.r2 = 0;
		this.outputLeft = 0;
		this.outputRight = 0;
	}

	public processStereo(left: number, right: number): void {
		const outputL = this.b0 * left + this.l1;
		const outputR = this.b0 * right + this.r1;
		this.l1 = this.b1 * left - this.a1 * outputL + this.l2;
		this.l2 = this.b2 * left - this.a2 * outputL;
		this.r1 = this.b1 * right - this.a1 * outputR + this.r2;
		this.r2 = this.b2 * right - this.a2 * outputR;
		this.outputLeft = outputL;
		this.outputRight = outputR;
	}
}

export function configureBiquadFilter(
	state: BiquadFilterState,
	type: BiquadFilterType,
	frequencyValue: number,
	q: number,
	gain: number,
	sampleRate: number,
): void {
	const frequency = clamp(frequencyValue, 0.001, sampleRate * 0.499);
	const omega = 2 * Math.PI * frequency / sampleRate;
	const sin = Math.sin(omega);
	const cos = Math.cos(omega);
	const alpha = sin / (2 * q);
	const a = Math.pow(10, gain / 40);
	const sqrtA = Math.sqrt(a);
	const twoSqrtAAlpha = 2 * sqrtA * alpha;
	let b0 = 1;
	let b1 = 0;
	let b2 = 0;
	let a0 = 1;
	let a1 = 0;
	let a2 = 0;
	switch (type) {
		case 'lowpass':
			b0 = (1 - cos) * 0.5;
			b1 = 1 - cos;
			b2 = (1 - cos) * 0.5;
			a0 = 1 + alpha;
			a1 = -2 * cos;
			a2 = 1 - alpha;
			break;
		case 'highpass':
			b0 = (1 + cos) * 0.5;
			b1 = -(1 + cos);
			b2 = (1 + cos) * 0.5;
			a0 = 1 + alpha;
			a1 = -2 * cos;
			a2 = 1 - alpha;
			break;
		case 'bandpass':
			b0 = sin * 0.5;
			b1 = 0;
			b2 = -sin * 0.5;
			a0 = 1 + alpha;
			a1 = -2 * cos;
			a2 = 1 - alpha;
			break;
		case 'notch':
			b0 = 1;
			b1 = -2 * cos;
			b2 = 1;
			a0 = 1 + alpha;
			a1 = -2 * cos;
			a2 = 1 - alpha;
			break;
		case 'allpass':
			b0 = 1 - alpha;
			b1 = -2 * cos;
			b2 = 1 + alpha;
			a0 = 1 + alpha;
			a1 = -2 * cos;
			a2 = 1 - alpha;
			break;
		case 'peaking':
			b0 = 1 + alpha * a;
			b1 = -2 * cos;
			b2 = 1 - alpha * a;
			a0 = 1 + alpha / a;
			a1 = -2 * cos;
			a2 = 1 - alpha / a;
			break;
		case 'lowshelf':
			b0 = a * ((a + 1) - (a - 1) * cos + twoSqrtAAlpha);
			b1 = 2 * a * ((a - 1) - (a + 1) * cos);
			b2 = a * ((a + 1) - (a - 1) * cos - twoSqrtAAlpha);
			a0 = (a + 1) + (a - 1) * cos + twoSqrtAAlpha;
			a1 = -2 * ((a - 1) + (a + 1) * cos);
			a2 = (a + 1) + (a - 1) * cos - twoSqrtAAlpha;
			break;
		case 'highshelf':
			b0 = a * ((a + 1) + (a - 1) * cos + twoSqrtAAlpha);
			b1 = -2 * a * ((a - 1) + (a + 1) * cos);
			b2 = a * ((a + 1) + (a - 1) * cos - twoSqrtAAlpha);
			a0 = (a + 1) - (a - 1) * cos + twoSqrtAAlpha;
			a1 = 2 * ((a - 1) - (a + 1) * cos);
			a2 = (a + 1) - (a - 1) * cos - twoSqrtAAlpha;
			break;
	}
	const invA0 = 1 / a0;
	state.enabled = true;
	state.b0 = b0 * invA0;
	state.b1 = b1 * invA0;
	state.b2 = b2 * invA0;
	state.a1 = a1 * invA0;
	state.a2 = a2 * invA0;
	state.l1 = 0;
	state.l2 = 0;
	state.r1 = 0;
	state.r2 = 0;
}
