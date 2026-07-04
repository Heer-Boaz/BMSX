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

export interface ApuOutputPlayback {
	playbackRate: number;
	gainLinear: number;
	filterEnabled: boolean;
	filterType: ApuFilterType;
	filterFrequency: number;
	filterQ: number;
	filterGain: number;
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
		playbackRate: resolveApuPlaybackRate(registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX]!),
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
