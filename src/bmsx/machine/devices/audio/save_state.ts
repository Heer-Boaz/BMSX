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


