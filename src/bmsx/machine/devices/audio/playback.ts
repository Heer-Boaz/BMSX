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
	APU_PARAMETER_RATE_STEP_Q16_INDEX,
	APU_RATE_STEP_Q16_ONE,
	type ApuParameterRegisterWords,
} from './contracts';

export type ApuFilterType = BiquadFilterType;

export interface ApuOutputFilter {
	type: ApuFilterType;
	frequency: number;
	q: number;
	gain: number;
}

export interface ApuOutputPlayback {
	playbackRate: number;
	gainLinear: number;
	filter: ApuOutputFilter | null;
}

export function resolveApuGainLinear(gainQ12Word: number): number {
	return toSignedWord(gainQ12Word) / APU_GAIN_Q12_ONE;
}

export function resolveApuPlaybackRate(rateStepQ16Word: number): number {
	return toSignedWord(rateStepQ16Word) / APU_RATE_STEP_Q16_ONE;
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

export function resolveApuOutputFilter(registerWords: ApuParameterRegisterWords): ApuOutputFilter | null {
	const filterKind = registerWords[APU_PARAMETER_FILTER_KIND_INDEX]!;
	if (filterKind === APU_FILTER_NONE) {
		return null;
	}
	return {
		type: decodeApuFilterType(filterKind),
		frequency: toSignedWord(registerWords[APU_PARAMETER_FILTER_FREQ_HZ_INDEX]!),
		q: toSignedWord(registerWords[APU_PARAMETER_FILTER_Q_MILLI_INDEX]!) / 1000,
		gain: toSignedWord(registerWords[APU_PARAMETER_FILTER_GAIN_MILLIDB_INDEX]!) / 1000,
	};
}

export function resolveApuOutputPlayback(registerWords: ApuParameterRegisterWords): ApuOutputPlayback {
	return {
		playbackRate: resolveApuPlaybackRate(registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX]!),
		gainLinear: resolveApuGainLinear(registerWords[APU_PARAMETER_GAIN_Q12_INDEX]!),
		filter: resolveApuOutputFilter(registerWords),
	};
}
