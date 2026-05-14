import type { ApuAudioSlot } from './contracts';

export type ApuBiquadFilterState = {
	enabled: boolean;
	b0: number;
	b1: number;
	b2: number;
	a1: number;
	a2: number;
	l1: number;
	l2: number;
	r1: number;
	r2: number;
};

export type ApuBadpDecoderSaveState = {
	predictors: number[];
	stepIndices: number[];
	nextFrame: number;
	blockEnd: number;
	blockFrames: number;
	blockFrameIndex: number;
	payloadOffset: number;
	nibbleCursor: number;
	decodedFrame: number;
	decodedLeft: number;
	decodedRight: number;
};

export type ApuOutputVoiceState = {
	slot: ApuAudioSlot;
	position: number;
	step: number;
	gain: number;
	targetGain: number;
	gainRampRemaining: number;
	stopAfter: number;
	filterSampleRate: number;
	filter: ApuBiquadFilterState;
	badp: ApuBadpDecoderSaveState;
};

export type ApuOutputState = {
	voices: ApuOutputVoiceState[];
};

export type AudioControllerState = {
	registerWords: number[];
	commandFifoCommands: number[];
	commandFifoRegisterWords: number[];
	commandFifoReadIndex: number;
	commandFifoWriteIndex: number;
	commandFifoCount: number;
	eventSequence: number;
	eventKind: number;
	eventSlot: number;
	eventSourceAddr: number;
	slotPhases: number[];
	slotRegisterWords: number[];
	slotSourceBytes: Uint8Array[];
	slotPlaybackCursorQ16: number[];
	slotFadeSamplesRemaining: number[];
	slotFadeSamplesTotal: number[];
	output: ApuOutputState;
	sampleCarry: number;
	availableSamples: number;
	apuStatus: number;
	apuFaultCode: number;
	apuFaultDetail: number;
};

export type ApuMutableNumberArrayLike = ArrayLike<number> & { [index: number]: number };

export type ApuBadpDecoderStateAccess = Omit<ApuBadpDecoderSaveState, 'predictors' | 'stepIndices'> & {
	predictors: ApuMutableNumberArrayLike;
	stepIndices: ApuMutableNumberArrayLike;
};

export type ApuOutputVoiceStateAccess = Omit<ApuOutputVoiceState, 'filter' | 'badp'> & {
	filter: ApuBiquadFilterState;
	badp: ApuBadpDecoderStateAccess;
};

export function captureApuOutputVoiceState(record: ApuOutputVoiceStateAccess): ApuOutputVoiceState {
	return {
		slot: record.slot,
		position: record.position,
		step: record.step,
		gain: record.gain,
		targetGain: record.targetGain,
		gainRampRemaining: record.gainRampRemaining,
		stopAfter: record.stopAfter,
		filterSampleRate: record.filterSampleRate,
		filter: {
			enabled: record.filter.enabled,
			b0: record.filter.b0,
			b1: record.filter.b1,
			b2: record.filter.b2,
			a1: record.filter.a1,
			a2: record.filter.a2,
			l1: record.filter.l1,
			l2: record.filter.l2,
			r1: record.filter.r1,
			r2: record.filter.r2,
		},
		badp: {
			predictors: Array.from(record.badp.predictors),
			stepIndices: Array.from(record.badp.stepIndices),
			nextFrame: record.badp.nextFrame,
			blockEnd: record.badp.blockEnd,
			blockFrames: record.badp.blockFrames,
			blockFrameIndex: record.badp.blockFrameIndex,
			payloadOffset: record.badp.payloadOffset,
			nibbleCursor: record.badp.nibbleCursor,
			decodedFrame: record.badp.decodedFrame,
			decodedLeft: record.badp.decodedLeft,
			decodedRight: record.badp.decodedRight,
		},
	};
}

export function restoreApuOutputVoiceState(record: ApuOutputVoiceStateAccess, state: ApuOutputVoiceState): void {
	record.position = state.position;
	record.step = state.step;
	record.gain = state.gain;
	record.targetGain = state.targetGain;
	record.gainRampRemaining = state.gainRampRemaining;
	record.stopAfter = state.stopAfter;
	record.filterSampleRate = state.filterSampleRate;
	record.filter.enabled = state.filter.enabled;
	record.filter.b0 = state.filter.b0;
	record.filter.b1 = state.filter.b1;
	record.filter.b2 = state.filter.b2;
	record.filter.a1 = state.filter.a1;
	record.filter.a2 = state.filter.a2;
	record.filter.l1 = state.filter.l1;
	record.filter.l2 = state.filter.l2;
	record.filter.r1 = state.filter.r1;
	record.filter.r2 = state.filter.r2;
	record.badp.predictors[0] = state.badp.predictors[0]!;
	record.badp.predictors[1] = state.badp.predictors[1]!;
	record.badp.stepIndices[0] = state.badp.stepIndices[0]!;
	record.badp.stepIndices[1] = state.badp.stepIndices[1]!;
	record.badp.nextFrame = state.badp.nextFrame;
	record.badp.blockEnd = state.badp.blockEnd;
	record.badp.blockFrames = state.badp.blockFrames;
	record.badp.blockFrameIndex = state.badp.blockFrameIndex;
	record.badp.payloadOffset = state.badp.payloadOffset;
	record.badp.nibbleCursor = state.badp.nibbleCursor;
	record.badp.decodedFrame = state.badp.decodedFrame;
	record.badp.decodedLeft = state.badp.decodedLeft;
	record.badp.decodedRight = state.badp.decodedRight;
}
