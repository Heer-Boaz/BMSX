import {
	APU_FILTER_COEFFICIENT_ONE,
	APU_FILTER_CONTROL_ENABLE,
	APU_SAMPLE_RATE_HZ,
} from '../../../machine/ts/spec/audio/apu';

export type AemFilterDefinition = {
	type: 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'allpass' | 'peaking' | 'lowshelf' | 'highshelf';
	frequency: number;
	q: number;
	gain: number;
};

export type AemFilterWords = {
	filter_control: number;
	filter_b0_b1: number;
	filter_b2_a1: number;
	filter_a2: number;
};

type FilterCoefficients = {
	b0: number;
	b1: number;
	b2: number;
	a1: number;
	a2: number;
};

function designFilterCoefficients(filter: AemFilterDefinition): FilterCoefficients {
	const omega = 2 * Math.PI * filter.frequency / APU_SAMPLE_RATE_HZ;
	const sinOmega = Math.sin(omega);
	const cosOmega = Math.cos(omega);
	const alpha = sinOmega / (2 * filter.q);
	let amplitude = 1;
	switch (filter.type) {
		case 'peaking':
		case 'lowshelf':
		case 'highshelf':
			amplitude = 10 ** (filter.gain / 40);
	}
	let b0: number;
	let b1: number;
	let b2: number;
	let a0: number;
	let a1: number;
	let a2: number;

	switch (filter.type) {
		case 'lowpass':
			b0 = (1 - cosOmega) * 0.5;
			b1 = 1 - cosOmega;
			b2 = b0;
			a0 = 1 + alpha;
			a1 = -2 * cosOmega;
			a2 = 1 - alpha;
			break;
		case 'highpass':
			b0 = (1 + cosOmega) * 0.5;
			b1 = -(1 + cosOmega);
			b2 = b0;
			a0 = 1 + alpha;
			a1 = -2 * cosOmega;
			a2 = 1 - alpha;
			break;
		case 'bandpass':
			b0 = sinOmega * 0.5;
			b1 = 0;
			b2 = -b0;
			a0 = 1 + alpha;
			a1 = -2 * cosOmega;
			a2 = 1 - alpha;
			break;
		case 'notch':
			b0 = 1;
			b1 = -2 * cosOmega;
			b2 = 1;
			a0 = 1 + alpha;
			a1 = b1;
			a2 = 1 - alpha;
			break;
		case 'allpass':
			b0 = 1 - alpha;
			b1 = -2 * cosOmega;
			b2 = 1 + alpha;
			a0 = b2;
			a1 = b1;
			a2 = b0;
			break;
		case 'peaking': {
			b0 = 1 + alpha * amplitude;
			b1 = -2 * cosOmega;
			b2 = 1 - alpha * amplitude;
			a0 = 1 + alpha / amplitude;
			a1 = b1;
			a2 = 1 - alpha / amplitude;
			break;
		}
		case 'lowshelf': {
			const twoSqrtAmplitudeAlpha = 2 * Math.sqrt(amplitude) * alpha;
			b0 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosOmega + twoSqrtAmplitudeAlpha);
			b1 = 2 * amplitude * ((amplitude - 1) - (amplitude + 1) * cosOmega);
			b2 = amplitude * ((amplitude + 1) - (amplitude - 1) * cosOmega - twoSqrtAmplitudeAlpha);
			a0 = (amplitude + 1) + (amplitude - 1) * cosOmega + twoSqrtAmplitudeAlpha;
			a1 = -2 * ((amplitude - 1) + (amplitude + 1) * cosOmega);
			a2 = (amplitude + 1) + (amplitude - 1) * cosOmega - twoSqrtAmplitudeAlpha;
			break;
		}
		case 'highshelf': {
			const twoSqrtAmplitudeAlpha = 2 * Math.sqrt(amplitude) * alpha;
			b0 = amplitude * ((amplitude + 1) + (amplitude - 1) * cosOmega + twoSqrtAmplitudeAlpha);
			b1 = -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosOmega);
			b2 = amplitude * ((amplitude + 1) + (amplitude - 1) * cosOmega - twoSqrtAmplitudeAlpha);
			a0 = (amplitude + 1) - (amplitude - 1) * cosOmega + twoSqrtAmplitudeAlpha;
			a1 = 2 * ((amplitude - 1) - (amplitude + 1) * cosOmega);
			a2 = (amplitude + 1) - (amplitude - 1) * cosOmega - twoSqrtAmplitudeAlpha;
			break;
		}
	}

	const normalization = 1 / a0;
	return {
		b0: b0 * normalization,
		b1: b1 * normalization,
		b2: b2 * normalization,
		a1: a1 * normalization,
		a2: a2 * normalization,
	};
}

function encodeFilterCoefficient(value: number): number {
	const scaled = value < 0
		? -Math.trunc((-value * APU_FILTER_COEFFICIENT_ONE) + 0.5)
		: Math.trunc((value * APU_FILTER_COEFFICIENT_ONE) + 0.5);
	if (scaled < -0x8000) {
		return 0x8000;
	}
	if (scaled > 0x7fff) {
		return 0x7fff;
	}
	return scaled & 0xffff;
}

function packFilterCoefficients(low: number, high: number): number {
	return ((low & 0xffff) | ((high & 0xffff) << 16)) >>> 0;
}

export function cookAemFilter(filter: AemFilterDefinition): AemFilterWords {
	const coefficients = designFilterCoefficients(filter);
	return {
		filter_control: APU_FILTER_CONTROL_ENABLE,
		filter_b0_b1: packFilterCoefficients(
			encodeFilterCoefficient(coefficients.b0),
			encodeFilterCoefficient(coefficients.b1),
		),
		filter_b2_a1: packFilterCoefficients(
			encodeFilterCoefficient(coefficients.b2),
			encodeFilterCoefficient(coefficients.a1),
		),
		filter_a2: encodeFilterCoefficient(coefficients.a2),
	};
}
