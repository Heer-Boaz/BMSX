import type { BiquadFilterType } from './biquad_filter';
import { toSignedWord } from '../../common/numeric';
import {
	APU_FILTER_ALLPASS,
	APU_FILTER_BANDPASS,
	APU_FILTER_HIGHPASS,
	APU_FILTER_HIGHSHELF,
	APU_FILTER_LOWSHELF,
	APU_FILTER_NONE,
	APU_FILTER_NOTCH,
	APU_FILTER_PEAKING,
	APU_GAIN_Q12_ONE,
	APU_PARAMETER_FILTER_FREQ_HZ_INDEX,
	APU_PARAMETER_FILTER_GAIN_MILLIDB_INDEX,
	APU_PARAMETER_FILTER_KIND_INDEX,
	APU_PARAMETER_FILTER_Q_MILLI_INDEX,
	APU_PARAMETER_GAIN_Q12_INDEX,
	APU_SAMPLE_RATE_HZ,
	type ApuParameterRegisterWords,
} from './contracts';

const U16_BASE = 0x1_0000;
const U16_BASE_SQUARED = 0x1_0000_0000;
const U16_BASE_CUBED = 0x1_0000_0000_0000;

export type ApuFilterType = BiquadFilterType;

export interface ApuOutputPlayback {
	gainLinear: number;
	filterEnabled: boolean;
	filterType: ApuFilterType;
	filterFrequency: number;
	filterQ: number;
	filterGain: number;
}

export interface ApuPhaseStep {
	wholeQ16: number;
	remainder: number;
}

export function resolveApuGainLinear(gainQ12Word: number): number {
	return toSignedWord(gainQ12Word) / APU_GAIN_Q12_ONE;
}

export function resolveApuPhaseStep(out: ApuPhaseStep, rateStepQ16Word: number, sourceSampleRateHz: number): void {
	const signedRateStep = toSignedWord(rateStepQ16Word);
	const negative = signedRateStep < 0;
	const magnitude = negative ? -signedRateStep : signedRateStep;
	const sampleRate = sourceSampleRateHz >>> 0;
	const lhsLow = magnitude % U16_BASE;
	const lhsHigh = (magnitude - lhsLow) / U16_BASE;
	const rhsLow = sampleRate % U16_BASE;
	const rhsHigh = (sampleRate - rhsLow) / U16_BASE;

	let product = lhsLow * rhsLow;
	const limb0 = product % U16_BASE;
	let carry = (product - limb0) / U16_BASE;
	product = lhsLow * rhsHigh + lhsHigh * rhsLow + carry;
	const limb1 = product % U16_BASE;
	carry = (product - limb1) / U16_BASE;
	product = lhsHigh * rhsHigh + carry;
	const limb2 = product % U16_BASE;
	const limb3 = (product - limb2) / U16_BASE;

	let dividend = limb3;
	const quotient3 = (dividend - dividend % APU_SAMPLE_RATE_HZ) / APU_SAMPLE_RATE_HZ;
	let remainder = dividend % APU_SAMPLE_RATE_HZ;
	dividend = remainder * U16_BASE + limb2;
	const quotient2 = (dividend - dividend % APU_SAMPLE_RATE_HZ) / APU_SAMPLE_RATE_HZ;
	remainder = dividend % APU_SAMPLE_RATE_HZ;
	dividend = remainder * U16_BASE + limb1;
	const quotient1 = (dividend - dividend % APU_SAMPLE_RATE_HZ) / APU_SAMPLE_RATE_HZ;
	remainder = dividend % APU_SAMPLE_RATE_HZ;
	dividend = remainder * U16_BASE + limb0;
	const quotient0 = (dividend - dividend % APU_SAMPLE_RATE_HZ) / APU_SAMPLE_RATE_HZ;
	remainder = dividend % APU_SAMPLE_RATE_HZ;

	const wholeQ16 = quotient0 + quotient1 * U16_BASE + quotient2 * U16_BASE_SQUARED + quotient3 * U16_BASE_CUBED;
	out.wholeQ16 = negative ? -wholeQ16 : wholeQ16;
	out.remainder = negative ? -remainder : remainder;
}

function decodeApuFilterType(kind: number): ApuFilterType {
	switch (kind) {
		case APU_FILTER_HIGHPASS:
			return 'highpass';
		case APU_FILTER_BANDPASS:
			return 'bandpass';
		case APU_FILTER_NOTCH:
			return 'notch';
		case APU_FILTER_ALLPASS:
			return 'allpass';
		case APU_FILTER_PEAKING:
			return 'peaking';
		case APU_FILTER_LOWSHELF:
			return 'lowshelf';
		case APU_FILTER_HIGHSHELF:
			return 'highshelf';
		default:
			return 'lowpass';
	}
}

export function applyApuOutputFilter(playback: ApuOutputPlayback, registerWords: ApuParameterRegisterWords): void {
	const filterKind = registerWords[APU_PARAMETER_FILTER_KIND_INDEX]!;
	playback.filterEnabled = filterKind !== APU_FILTER_NONE;
	playback.filterType = decodeApuFilterType(filterKind);
	playback.filterFrequency = toSignedWord(registerWords[APU_PARAMETER_FILTER_FREQ_HZ_INDEX]!);
	playback.filterQ = toSignedWord(registerWords[APU_PARAMETER_FILTER_Q_MILLI_INDEX]!) / 1000;
	playback.filterGain = toSignedWord(registerWords[APU_PARAMETER_FILTER_GAIN_MILLIDB_INDEX]!) / 1000;
}

export function resolveApuOutputPlayback(registerWords: ApuParameterRegisterWords): ApuOutputPlayback {
	const playback: ApuOutputPlayback = {
		gainLinear: resolveApuGainLinear(registerWords[APU_PARAMETER_GAIN_Q12_INDEX]!),
		filterEnabled: false,
		filterType: 'lowpass',
		filterFrequency: 0,
		filterQ: 0,
		filterGain: 0,
	};
	applyApuOutputFilter(playback, registerWords);
	return playback;
}
