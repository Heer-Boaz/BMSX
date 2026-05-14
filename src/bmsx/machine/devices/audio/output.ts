import { clamp, clamp01 } from '../../../common/clamp';
import { readI16LE, readLE16, readLE32 } from '../../../common/endian';
import { BiquadFilterState, configureBiquadFilter, type BiquadFilterType } from './biquad_filter';
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
	APU_FAULT_NONE,
	APU_FAULT_OUTPUT_BLOCK,
	APU_FAULT_OUTPUT_DATA_RANGE,
	APU_FAULT_OUTPUT_METADATA,
	APU_FAULT_OUTPUT_PLAYBACK_RATE,
	APU_FAULT_SOURCE_BIT_DEPTH,
	APU_FAULT_SOURCE_CHANNELS,
	APU_FAULT_SOURCE_DATA_RANGE,
	APU_FAULT_SOURCE_FRAME_COUNT,
	APU_FAULT_SOURCE_SAMPLE_RATE,
	APU_FAULT_UNSUPPORTED_FORMAT,
	APU_GAIN_Q12_ONE,
	APU_GENERATOR_NONE,
	APU_GENERATOR_SQUARE,
	APU_OUTPUT_QUEUE_CAPACITY_FRAMES,
	APU_OUTPUT_QUEUE_CAPACITY_SAMPLES,
	APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX,
	APU_PARAMETER_GENERATOR_KIND_INDEX,
	APU_PARAMETER_SOURCE_ADDR_INDEX,
	APU_PARAMETER_SOURCE_BITS_PER_SAMPLE_INDEX,
	APU_PARAMETER_SOURCE_BYTES_INDEX,
	APU_PARAMETER_SOURCE_CHANNELS_INDEX,
	APU_PARAMETER_SOURCE_DATA_BYTES_INDEX,
	APU_PARAMETER_SOURCE_DATA_OFFSET_INDEX,
	APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX,
	APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX,
	APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX,
	APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX,
	APU_PARAMETER_FILTER_FREQ_HZ_INDEX,
	APU_PARAMETER_FILTER_GAIN_MILLIDB_INDEX,
	APU_PARAMETER_FILTER_KIND_INDEX,
	APU_PARAMETER_FILTER_Q_MILLI_INDEX,
	APU_PARAMETER_GAIN_Q12_INDEX,
	APU_PARAMETER_RATE_STEP_Q16_INDEX,
	APU_PARAMETER_START_SAMPLE_INDEX,
	APU_RATE_STEP_Q16_ONE,
	APU_SAMPLE_RATE_HZ,
	apuAudioSourceUsesGenerator,
	type ApuAudioSlot,
	type ApuAudioSource,
	type ApuParameterRegisterWords,
	type ApuVoiceId,
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

export interface ApuOutputStartResult {
	faultCode: number;
	faultDetail: number;
}

type ApuOutputBadpSeekTable = {
	frames: Uint32Array;
	offsets: Uint32Array;
};

type ApuOutputBadpSeekTableResult = ApuOutputStartResult & {
	seekTable: ApuOutputBadpSeekTable | null;
};

type ApuBadpDecoderState = {
	predictors: Int32Array;
	stepIndices: Int32Array;
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

type ApuOutputVoice = {
	voiceId: ApuVoiceId;
	slot: ApuAudioSlot;
	sampleRate: number;
	channels: number;
	bitsPerSample: number;
	sourceBytes: Uint8Array;
	dataOffset: number;
	dataSize: number;
	frames: number;
	generatorKind: number;
	generatorDutyQ12: number;
	badpSeekFrames: Uint32Array;
	badpSeekOffsets: Uint32Array;
	loopStartFrame: number;
	loopEndFrame: number;
	playback: ApuOutputPlayback;
	position: number;
	step: number;
	gain: number;
	targetGain: number;
	gainRampRemaining: number;
	stopAfter: number;
	filterSampleRate: number;
	filter: BiquadFilterState;
	usesBadp: boolean;
	badp: ApuBadpDecoderState;
};

const MIN_GAIN = 0.0001;
const PCM_SCALE = 1 / 32768;
const BADP_HEADER_SIZE = 48;
const BADP_VERSION = 1;
const APU_OUTPUT_START_OK: ApuOutputStartResult = { faultCode: APU_FAULT_NONE, faultDetail: 0 };
const EMPTY_BADP_SEEK_TABLE: ApuOutputBadpSeekTable = { frames: new Uint32Array(0), offsets: new Uint32Array(0) };

const BADP_STEP_TABLE = new Int32Array([
	7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
	19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
	50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
	130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
	337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
	876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
	2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
	5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
	15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
]);

const BADP_INDEX_TABLE = new Int32Array([
	-1, -1, -1, -1, 2, 4, 6, 8,
	-1, -1, -1, -1, 2, 4, 6, 8,
]);

function audioFrameIndex(position: number): number {
	return position - (position % 1);
}

function squareGeneratorSample(position: number, dutyQ12: number): number {
	const frameIndex = audioFrameIndex(position);
	return (position - frameIndex) * APU_GAIN_Q12_ONE < dutyQ12 ? 1 : -1;
}

export function resolveApuGainLinear(gainQ12Word: number): number {
	return toSignedWord(gainQ12Word) / APU_GAIN_Q12_ONE;
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
	const playback: ApuOutputPlayback = {
		playbackRate: toSignedWord(registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX]!) / APU_RATE_STEP_Q16_ONE,
		gainLinear: resolveApuGainLinear(registerWords[APU_PARAMETER_GAIN_Q12_INDEX]!),
		filter: resolveApuOutputFilter(registerWords),
	};
	return playback;
}

export class ApuOutputMixer {
	private readonly voices: ApuOutputVoice[] = [];
	private readonly mixBuffer = new Float32Array(APU_OUTPUT_QUEUE_CAPACITY_SAMPLES);
	private readonly outputQueue = new Int16Array(APU_OUTPUT_QUEUE_CAPACITY_SAMPLES);
	private readonly outputRenderBuffer = new Int16Array(APU_OUTPUT_QUEUE_CAPACITY_SAMPLES);
	private outputQueueReadFrame = 0;
	private outputQueueFrames = 0;
	private sampledLeft = 0;
	private sampledRight = 0;

	public resetPlaybackState(): void {
		this.voices.length = 0;
		this.clearOutputQueue();
	}

	public clearOutputQueue(): void {
		this.outputQueueReadFrame = 0;
		this.outputQueueFrames = 0;
	}

	public queuedOutputFrames(): number {
		return this.outputQueueFrames;
	}

	public capacityOutputFrames(): number {
		return APU_OUTPUT_QUEUE_CAPACITY_FRAMES;
	}

	public freeOutputFrames(): number {
		return APU_OUTPUT_QUEUE_CAPACITY_FRAMES - this.outputQueueFrames;
	}

	public pullOutputFrames(output: Int16Array, frameCount: number, outputSampleRate: number, outputGain: number, targetQueuedFrames = 0): void {
		if (frameCount > APU_OUTPUT_QUEUE_CAPACITY_FRAMES) {
			throw new Error('[AOUT] Host pull exceeds the output-ring capacity.');
		}
		this.fillOutputQueueTo(frameCount, outputSampleRate, outputGain);
		this.readOutputQueue(output, frameCount);
		this.fillOutputQueueTo(targetQueuedFrames, outputSampleRate, outputGain);
	}

	public playVoice(
		slot: ApuAudioSlot,
		voiceId: ApuVoiceId,
		source: ApuAudioSource,
		sourceBytes: Uint8Array,
		registerWords: ApuParameterRegisterWords,
		playbackCursorQ16: number,
		stopFadeSamples = 0,
	): ApuOutputStartResult {
		const playback = resolveApuOutputPlayback(registerWords);
		if (playback.playbackRate <= 0) {
			return { faultCode: APU_FAULT_OUTPUT_PLAYBACK_RATE, faultDetail: registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX]! };
		}
		const metadataResult = this.validateAoutSourceMetadata(source);
		if (metadataResult.faultCode !== APU_FAULT_NONE) {
			return metadataResult;
		}
		let seekTable = EMPTY_BADP_SEEK_TABLE;
		if (!apuAudioSourceUsesGenerator(source)) {
			if (source.bitsPerSample === 4) {
				const badpSeek = this.readBadpSeekTable(sourceBytes, source);
				if (badpSeek.faultCode !== APU_FAULT_NONE) {
					return { faultCode: badpSeek.faultCode, faultDetail: badpSeek.faultDetail };
				}
				seekTable = badpSeek.seekTable!;
			} else {
				const pcmResult = this.validatePcmSourceData(source);
				if (pcmResult.faultCode !== APU_FAULT_NONE) {
					return pcmResult;
				}
			}
		}
		const record = this.buildVoiceFromData(slot, voiceId, source, sourceBytes, seekTable.frames, seekTable.offsets, playback, playbackCursorQ16, clamp01(playback.gainLinear));
		if (stopFadeSamples > 0) {
			const fadeSec = stopFadeSamples / APU_SAMPLE_RATE_HZ;
			this.rampVoiceGain(record, MIN_GAIN, fadeSec);
			record.stopAfter = fadeSec;
		}
		this.voices.push(record);
		return APU_OUTPUT_START_OK;
	}

	public writeSlotRegisterWord(slot: ApuAudioSlot, source: ApuAudioSource, registerWords: ApuParameterRegisterWords, parameterIndex: number, playbackCursorQ16: number): ApuOutputStartResult {
		let playbackRate = 0;
		switch (parameterIndex) {
			case APU_PARAMETER_SOURCE_ADDR_INDEX:
			case APU_PARAMETER_SOURCE_BYTES_INDEX:
			case APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX:
			case APU_PARAMETER_SOURCE_CHANNELS_INDEX:
			case APU_PARAMETER_SOURCE_BITS_PER_SAMPLE_INDEX:
			case APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX:
			case APU_PARAMETER_SOURCE_DATA_OFFSET_INDEX:
			case APU_PARAMETER_SOURCE_DATA_BYTES_INDEX:
			case APU_PARAMETER_GENERATOR_KIND_INDEX:
				return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: parameterIndex };
			case APU_PARAMETER_RATE_STEP_Q16_INDEX: {
				const rateStepQ16Word = registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX]!;
				playbackRate = toSignedWord(rateStepQ16Word) / APU_RATE_STEP_Q16_ONE;
				if (playbackRate <= 0) {
					return { faultCode: APU_FAULT_OUTPUT_PLAYBACK_RATE, faultDetail: rateStepQ16Word };
				}
				break;
			}
		}
		const record = this.findSlot(slot);
		if (record === null) {
			return APU_OUTPUT_START_OK;
		}
		switch (parameterIndex) {
			case APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX:
			case APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX:
				this.applyVoiceLoopBounds(record, source);
				return APU_OUTPUT_START_OK;
			case APU_PARAMETER_RATE_STEP_Q16_INDEX:
				record.playback.playbackRate = playbackRate;
				record.step = playbackRate;
				return APU_OUTPUT_START_OK;
			case APU_PARAMETER_GAIN_Q12_INDEX:
				this.applyVoiceGainQ12(record, registerWords[APU_PARAMETER_GAIN_Q12_INDEX]!);
				return APU_OUTPUT_START_OK;
			case APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX:
				record.generatorDutyQ12 = source.generatorDutyQ12;
				return APU_OUTPUT_START_OK;
			case APU_PARAMETER_START_SAMPLE_INDEX:
				this.seekVoice(record, registerWords[APU_PARAMETER_START_SAMPLE_INDEX]!, playbackCursorQ16);
				return APU_OUTPUT_START_OK;
			case APU_PARAMETER_FILTER_KIND_INDEX:
			case APU_PARAMETER_FILTER_FREQ_HZ_INDEX:
			case APU_PARAMETER_FILTER_Q_MILLI_INDEX:
			case APU_PARAMETER_FILTER_GAIN_MILLIDB_INDEX:
				record.playback.filter = resolveApuOutputFilter(registerWords);
				record.filterSampleRate = 0;
				return APU_OUTPUT_START_OK;
			default:
				return APU_OUTPUT_START_OK;
		}
	}

	public stopSlot(slot: ApuAudioSlot, fadeSamples = 0): boolean {
		const index = this.findSlotIndex(slot);
		if (index < 0) {
			return false;
		}
		return this.stopVoiceAtIndex(index, fadeSamples);
	}

	public stopAllVoices(): void {
		while (this.voices.length > 0) {
			this.removeVoice(this.voices.length - 1);
		}
	}

	public renderSamples(output: Int16Array, frameCount: number, outputSampleRate: number, outputGain: number): void {
		const totalSamples = frameCount * 2;
		if (frameCount > APU_OUTPUT_QUEUE_CAPACITY_FRAMES) {
			throw new Error('[AOUT] Render request exceeds the output-ring capacity.');
		}
		this.mixBuffer.fill(0, 0, totalSamples);

		const invOutputRate = 1 / outputSampleRate;
		const mix = this.mixBuffer;

		for (let index = 0; index < this.voices.length;) {
			const record = this.voices[index]!;
			if (record.frames === 0) {
				this.removeVoice(index);
				continue;
			}

			const framesInRecord = record.frames;
			const framesInRecordF = framesInRecord;
			const hasLoop = record.loopEndFrame > record.loopStartFrame;
			const loopStart = hasLoop ? record.loopStartFrame : 0;
			const loopEnd = hasLoop ? record.loopEndFrame : framesInRecordF;
			const step = record.step * (record.sampleRate * invOutputRate);
			let position = record.position;
			let gain = record.gain;
			let rampRemaining = record.gainRampRemaining;
			let stopAfter = record.stopAfter;
			let gainStep = 0;
			if (rampRemaining > 0) {
				gainStep = (record.targetGain - gain) / (rampRemaining * outputSampleRate);
			}
			this.configureRecordFilter(record, outputSampleRate);

			let ended = false;
			let outIndex = 0;
			if (record.generatorKind === APU_GENERATOR_SQUARE) {
				for (let frame = 0; frame < frameCount; frame += 1) {
					if (stopAfter >= 0) {
						stopAfter -= invOutputRate;
						if (stopAfter <= 0) {
							ended = true;
							break;
						}
					}
					if (hasLoop) {
						if (position < loopStart || position >= loopEnd) {
							position = this.wrapLoopFrame(position, loopStart, loopEnd);
						}
					} else if (position >= framesInRecordF) {
						ended = true;
						break;
					}

					const sample = squareGeneratorSample(position, record.generatorDutyQ12);
					let left = sample;
					let right = sample;
					if (record.filter.enabled) {
						record.filter.processStereo(sample, sample);
						left = record.filter.outputLeft;
						right = record.filter.outputRight;
					}
					mix[outIndex] += left * gain;
					mix[outIndex + 1] += right * gain;
					outIndex += 2;
					if (hasLoop) {
						position = this.wrapLoopFrame(position + step, loopStart, loopEnd);
					} else {
						position += step;
					}
					if (rampRemaining > 0) {
						gain += gainStep;
						rampRemaining -= invOutputRate;
					}
				}
			} else {
				for (let frame = 0; frame < frameCount; frame += 1) {
					if (stopAfter >= 0) {
						stopAfter -= invOutputRate;
						if (stopAfter <= 0) {
							ended = true;
							break;
						}
					}
					if (hasLoop) {
						if (position < loopStart || position >= loopEnd) {
							position = this.wrapLoopFrame(position, loopStart, loopEnd);
						}
					} else if (position >= framesInRecordF) {
						ended = true;
						break;
					}

					const frameIndex = audioFrameIndex(position);
					const frac = position - frameIndex;
					let nextFrame = frameIndex + 1;
					if (hasLoop) {
						if (nextFrame >= loopEnd) {
							nextFrame = loopStart + (nextFrame - loopEnd);
						}
					} else if (nextFrame >= framesInRecord) {
						nextFrame = frameIndex;
					}

					if (!this.readVoiceFrame(record, frameIndex)) {
						ended = true;
						break;
					}
					const left0 = this.sampledLeft;
					const right0 = this.sampledRight;
					let left = left0;
					let right = right0;
					if (nextFrame !== frameIndex) {
						if (!this.readVoiceFrame(record, nextFrame)) {
							ended = true;
							break;
						}
						left = left0 + (this.sampledLeft - left0) * frac;
						right = right0 + (this.sampledRight - right0) * frac;
					}
					if (record.filter.enabled) {
						record.filter.processStereo(left, right);
						left = record.filter.outputLeft;
						right = record.filter.outputRight;
					}
					mix[outIndex] += left * gain;
					mix[outIndex + 1] += right * gain;
					outIndex += 2;
					position += step;
					if (hasLoop) {
						position = this.wrapLoopFrame(position, loopStart, loopEnd);
					}
					if (rampRemaining > 0) {
						gain += gainStep;
						rampRemaining -= invOutputRate;
					}
				}
			}

			record.position = position;
			record.gain = gain;
			record.gainRampRemaining = rampRemaining > 0 ? rampRemaining : 0;
			if (record.gainRampRemaining === 0) {
				record.gain = record.targetGain;
			}
			record.stopAfter = stopAfter;

			if (ended) {
				this.removeVoice(index);
				continue;
			}
			index += 1;
		}

		for (let index = 0; index < totalSamples; index += 1) {
			const sample = clamp(mix[index]! * outputGain, -1, 1);
			output[index] = Math.round(sample * 32767);
		}
	}

	private fillOutputQueueTo(targetFrames: number, outputSampleRate: number, outputGain: number): void {
		const capacityFrames = this.outputQueue.length >>> 1;
		if (targetFrames > capacityFrames) {
			targetFrames = capacityFrames;
		}
		const framesToRender = targetFrames - this.outputQueueFrames;
		if (framesToRender <= 0) {
			return;
		}
		this.renderSamples(this.outputRenderBuffer, framesToRender, outputSampleRate, outputGain);
		this.writeOutputQueue(this.outputRenderBuffer, framesToRender);
	}

	private writeOutputQueue(samples: Int16Array, frameCount: number): void {
		const capacityFrames = this.outputQueue.length >>> 1;
		const writeFrame = (this.outputQueueReadFrame + this.outputQueueFrames) % capacityFrames;
		let firstSpan = capacityFrames - writeFrame;
		if (firstSpan > frameCount) {
			firstSpan = frameCount;
		}
		let srcCursor = 0;
		let dstCursor = writeFrame * 2;
		for (let frame = 0; frame < firstSpan; frame += 1) {
			this.outputQueue[dstCursor] = samples[srcCursor]!;
			this.outputQueue[dstCursor + 1] = samples[srcCursor + 1]!;
			dstCursor += 2;
			srcCursor += 2;
		}
		const secondSpan = frameCount - firstSpan;
		dstCursor = 0;
		for (let frame = 0; frame < secondSpan; frame += 1) {
			this.outputQueue[dstCursor] = samples[srcCursor]!;
			this.outputQueue[dstCursor + 1] = samples[srcCursor + 1]!;
			dstCursor += 2;
			srcCursor += 2;
		}
		this.outputQueueFrames += frameCount;
	}

	private readOutputQueue(output: Int16Array, frameCount: number): void {
		const capacityFrames = this.outputQueue.length >>> 1;
		let firstSpan = capacityFrames - this.outputQueueReadFrame;
		if (firstSpan > frameCount) {
			firstSpan = frameCount;
		}
		let srcCursor = this.outputQueueReadFrame * 2;
		let dstCursor = 0;
		for (let frame = 0; frame < firstSpan; frame += 1) {
			output[dstCursor] = this.outputQueue[srcCursor]!;
			output[dstCursor + 1] = this.outputQueue[srcCursor + 1]!;
			srcCursor += 2;
			dstCursor += 2;
		}
		const secondSpan = frameCount - firstSpan;
		srcCursor = 0;
		for (let frame = 0; frame < secondSpan; frame += 1) {
			output[dstCursor] = this.outputQueue[srcCursor]!;
			output[dstCursor + 1] = this.outputQueue[srcCursor + 1]!;
			srcCursor += 2;
			dstCursor += 2;
		}
		this.outputQueueReadFrame = (this.outputQueueReadFrame + frameCount) % capacityFrames;
		this.outputQueueFrames -= frameCount;
		if (this.outputQueueFrames === 0) {
			this.outputQueueReadFrame = 0;
		}
	}

	private buildVoiceFromData(
		slot: ApuAudioSlot,
		voiceId: ApuVoiceId,
		source: ApuAudioSource,
		sourceBytes: Uint8Array,
		badpSeekFrames: Uint32Array,
		badpSeekOffsets: Uint32Array,
		playback: ApuOutputPlayback,
		playbackCursorQ16: number,
		initialGain: number,
	): ApuOutputVoice {
		const loopStartFrame = source.loopEndSample > source.loopStartSample ? source.loopStartSample : -1;
		const loopEndFrame = source.loopEndSample > source.loopStartSample ? source.loopEndSample : -1;
		let position = playbackCursorQ16 / APU_RATE_STEP_Q16_ONE;
		if (source.frameCount > 0) {
			if (loopEndFrame > loopStartFrame) {
				position %= source.frameCount;
				if (position < 0) {
					position += source.frameCount;
				}
			} else {
				position = clamp(position, 0, source.frameCount);
			}
		}
		const record: ApuOutputVoice = {
			voiceId,
			slot,
			sampleRate: source.sampleRateHz,
			channels: source.channels,
			bitsPerSample: source.bitsPerSample,
			sourceBytes,
			dataOffset: source.dataOffset,
			dataSize: source.dataBytes,
			frames: source.frameCount,
			generatorKind: source.generatorKind,
			generatorDutyQ12: source.generatorDutyQ12,
			badpSeekFrames,
			badpSeekOffsets,
			loopStartFrame,
			loopEndFrame,
			playback,
			position,
			step: playback.playbackRate,
			gain: initialGain,
			targetGain: initialGain,
			gainRampRemaining: 0,
			stopAfter: -1,
			filterSampleRate: 0,
			filter: new BiquadFilterState(),
			usesBadp: !apuAudioSourceUsesGenerator(source) && source.bitsPerSample === 4,
			badp: {
				predictors: new Int32Array(2),
				stepIndices: new Int32Array(2),
				nextFrame: 0,
				blockEnd: 0,
				blockFrames: 0,
				blockFrameIndex: 0,
				payloadOffset: 0,
				nibbleCursor: 0,
				decodedFrame: -1,
				decodedLeft: 0,
				decodedRight: 0,
			},
		};
		if (record.usesBadp) {
			this.badpResetDecoder(record, audioFrameIndex(record.position));
		}
		return record;
	}

	private findSlotIndex(slot: ApuAudioSlot): number {
		for (let index = 0; index < this.voices.length; index += 1) {
			if (this.voices[index]!.slot === slot) {
				return index;
			}
		}
		return -1;
	}

	private findSlot(slot: ApuAudioSlot): ApuOutputVoice | null {
		const index = this.findSlotIndex(slot);
		return index >= 0 ? this.voices[index]! : null;
	}

	private stopVoiceAtIndex(index: number, fadeSamples: number): boolean {
		if (fadeSamples > 0) {
			const fadeSec = fadeSamples / APU_SAMPLE_RATE_HZ;
			this.rampVoiceGain(this.voices[index]!, MIN_GAIN, fadeSec);
			this.voices[index]!.stopAfter = fadeSec;
			return true;
		}
		this.removeVoice(index);
		return true;
	}

	private removeVoice(index: number): void {
		const last = this.voices.length - 1;
		if (index !== last) {
			this.voices[index] = this.voices[last]!;
		}
		this.voices.pop();
	}

	private rampVoiceGain(record: ApuOutputVoice, target: number, durationSec: number): void {
		record.targetGain = target;
		record.gainRampRemaining = durationSec;
	}

	private applyVoiceGainQ12(record: ApuOutputVoice, gainQ12Word: number): void {
		const gainLinear = resolveApuGainLinear(gainQ12Word);
		const clamped = clamp01(gainLinear);
		record.playback.gainLinear = gainLinear;
		record.gain = clamped;
		record.targetGain = clamped;
		record.gainRampRemaining = 0;
	}

	private applyVoiceLoopBounds(record: ApuOutputVoice, source: ApuAudioSource): void {
		record.loopStartFrame = source.loopEndSample > source.loopStartSample ? source.loopStartSample : -1;
		record.loopEndFrame = source.loopEndSample > source.loopStartSample ? source.loopEndSample : -1;
	}

	private seekVoice(record: ApuOutputVoice, startFrame: number, playbackCursorQ16: number): void {
		record.position = playbackCursorQ16 / APU_RATE_STEP_Q16_ONE;
		if (record.usesBadp && startFrame <= record.frames) {
			this.badpResetDecoder(record, startFrame);
		}
	}

	private readVoiceFrame(record: ApuOutputVoice, frame: number): boolean {
		if (record.usesBadp) {
			return this.badpReadFrameAt(record, frame);
		}
		if (frame < 0 || frame >= record.frames) {
			return false;
		}
		const baseSample = frame * record.channels;
		if (record.bitsPerSample === 16) {
			const byteOffset = record.dataOffset + baseSample * 2;
			this.sampledLeft = readI16LE(record.sourceBytes, byteOffset) * PCM_SCALE;
			this.sampledRight = record.channels === 1 ? this.sampledLeft : readI16LE(record.sourceBytes, byteOffset + 2) * PCM_SCALE;
			return true;
		}
		const byteOffset = record.dataOffset + baseSample;
		this.sampledLeft = ((record.sourceBytes[byteOffset]! - 128) << 8) * PCM_SCALE;
		this.sampledRight = record.channels === 1 ? this.sampledLeft : ((record.sourceBytes[byteOffset + 1]! - 128) << 8) * PCM_SCALE;
		return true;
	}

	private wrapLoopFrame(position: number, loopStart: number, loopEnd: number): number {
		const length = loopEnd - loopStart;
		let wrapped = (position - loopStart) % length;
		if (wrapped < 0) {
			wrapped += length;
		}
		return loopStart + wrapped;
	}

	private configureRecordFilter(record: ApuOutputVoice, outputSampleRate: number): void {
		const filter = record.playback.filter;
		if (filter === null) {
			record.filter.reset();
			record.filterSampleRate = 0;
			return;
		}
		if (record.filterSampleRate === outputSampleRate) {
			return;
		}
		configureBiquadFilter(record.filter, filter.type, filter.frequency, filter.q, filter.gain, outputSampleRate);
		record.filterSampleRate = outputSampleRate;
	}

	private validatePcmSourceData(source: ApuAudioSource): ApuOutputStartResult {
		const bytesPerSample = source.bitsPerSample === 16 ? 2 : 1;
		const requiredDataBytes = source.frameCount * source.channels * bytesPerSample;
		if (requiredDataBytes > source.dataBytes) {
			return { faultCode: APU_FAULT_OUTPUT_DATA_RANGE, faultDetail: source.dataBytes };
		}
		return APU_OUTPUT_START_OK;
	}

	private validateAoutSourceMetadata(source: ApuAudioSource): ApuOutputStartResult {
		if (source.sampleRateHz === 0) {
			return { faultCode: APU_FAULT_SOURCE_SAMPLE_RATE, faultDetail: source.sampleRateHz };
		}
		if (source.channels < 1 || source.channels > 2) {
			return { faultCode: APU_FAULT_SOURCE_CHANNELS, faultDetail: source.channels };
		}
		if (source.frameCount === 0) {
			return { faultCode: APU_FAULT_SOURCE_FRAME_COUNT, faultDetail: source.frameCount };
		}
		if (source.generatorKind !== APU_GENERATOR_NONE) {
			if (source.generatorKind === APU_GENERATOR_SQUARE) {
				return APU_OUTPUT_START_OK;
			}
			return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: source.generatorKind };
		}
		if (source.dataBytes === 0 || source.dataOffset > source.sourceBytes || source.dataBytes > source.sourceBytes - source.dataOffset) {
			return { faultCode: APU_FAULT_SOURCE_DATA_RANGE, faultDetail: source.dataOffset };
		}
		switch (source.bitsPerSample) {
			case 4:
			case 8:
			case 16:
				return APU_OUTPUT_START_OK;
		}
		return { faultCode: APU_FAULT_SOURCE_BIT_DEPTH, faultDetail: source.bitsPerSample };
	}

	private readBadpSeekTable(bytes: Uint8Array, source: ApuAudioSource): ApuOutputBadpSeekTableResult {
		if (bytes.byteLength < BADP_HEADER_SIZE || bytes[0] !== 0x42 || bytes[1] !== 0x41 || bytes[2] !== 0x44 || bytes[3] !== 0x50) {
			return { faultCode: APU_FAULT_UNSUPPORTED_FORMAT, faultDetail: bytes.byteLength, seekTable: null };
		}
		const version = readLE16(bytes, 4);
		if (version !== BADP_VERSION) {
			return { faultCode: APU_FAULT_UNSUPPORTED_FORMAT, faultDetail: version, seekTable: null };
		}
		const channels = readLE16(bytes, 6);
		const sampleRate = readLE32(bytes, 8);
		const frames = readLE32(bytes, 12);
		const seekEntryCount = readLE32(bytes, 28);
		const seekTableOffset = readLE32(bytes, 32);
		const dataOffset = readLE32(bytes, 36);
		if (channels !== source.channels || sampleRate !== source.sampleRateHz || frames !== source.frameCount || dataOffset !== source.dataOffset) {
			return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: dataOffset, seekTable: null };
		}
		if (dataOffset < BADP_HEADER_SIZE || dataOffset > bytes.byteLength) {
			return { faultCode: APU_FAULT_OUTPUT_DATA_RANGE, faultDetail: dataOffset, seekTable: null };
		}
		if (source.dataBytes === 0 || dataOffset + source.dataBytes > bytes.byteLength) {
			return { faultCode: APU_FAULT_OUTPUT_DATA_RANGE, faultDetail: source.dataBytes, seekTable: null };
		}
		if (seekEntryCount > 0 && (seekTableOffset < BADP_HEADER_SIZE || seekTableOffset >= dataOffset)) {
			return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: seekTableOffset, seekTable: null };
		}
		if (seekEntryCount > 0 && seekTableOffset + seekEntryCount * 8 > dataOffset) {
			return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: seekEntryCount, seekTable: null };
		}
		const seekCount = seekEntryCount > 0 ? seekEntryCount : 1;
		const seekFrames = new Uint32Array(seekCount);
		const seekOffsets = new Uint32Array(seekCount);
		if (seekEntryCount > 0) {
			let cursor = seekTableOffset;
			for (let index = 0; index < seekCount; index += 1) {
				seekFrames[index] = readLE32(bytes, cursor);
				seekOffsets[index] = readLE32(bytes, cursor + 4);
				cursor += 8;
			}
		} else {
			seekFrames[0] = 0;
			seekOffsets[0] = 0;
		}
		if (seekFrames[0] !== 0 || seekOffsets[0] !== 0) {
			return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: seekOffsets[0]!, seekTable: null };
		}
		for (let index = 0; index < seekCount; index += 1) {
			if (seekFrames[index]! > source.frameCount || seekOffsets[index]! >= source.dataBytes) {
				return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: index, seekTable: null };
			}
			if (index > 0 && (seekFrames[index]! < seekFrames[index - 1]! || seekOffsets[index]! < seekOffsets[index - 1]!)) {
				return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: index, seekTable: null };
			}
		}
		const blockResult = this.validateBadpBlocks(bytes, source, seekFrames, seekOffsets);
		if (blockResult.faultCode !== APU_FAULT_NONE) {
			return { faultCode: blockResult.faultCode, faultDetail: blockResult.faultDetail, seekTable: null };
		}
		return { faultCode: APU_FAULT_NONE, faultDetail: 0, seekTable: { frames: seekFrames, offsets: seekOffsets } };
	}

	private validateBadpBlocks(bytes: Uint8Array, source: ApuAudioSource, seekFrames: Uint32Array, seekOffsets: Uint32Array): ApuOutputStartResult {
		let offset = 0;
		let decodedFrames = 0;
		let seekIndex = 0;
		while (decodedFrames < source.frameCount) {
			while (seekIndex < seekOffsets.length && seekOffsets[seekIndex] === offset) {
				if (seekFrames[seekIndex] !== decodedFrames) {
					return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: seekIndex };
				}
				seekIndex += 1;
			}
			if (seekIndex < seekOffsets.length && seekOffsets[seekIndex]! < offset) {
				return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: seekIndex };
			}
			const blockOffset = source.dataOffset + offset;
			if (offset + 4 > source.dataBytes) {
				return { faultCode: APU_FAULT_OUTPUT_BLOCK, faultDetail: offset };
			}
			const blockFrames = readLE16(bytes, blockOffset);
			const blockBytes = readLE16(bytes, blockOffset + 2);
			if (blockFrames === 0) {
				return { faultCode: APU_FAULT_OUTPUT_BLOCK, faultDetail: offset };
			}
			const blockHeaderBytes = 4 + source.channels * 4;
			if (blockBytes < blockHeaderBytes) {
				return { faultCode: APU_FAULT_OUTPUT_BLOCK, faultDetail: offset };
			}
			const blockEnd = offset + blockBytes;
			if (blockEnd > source.dataBytes) {
				return { faultCode: APU_FAULT_OUTPUT_BLOCK, faultDetail: offset };
			}
			let channelCursor = blockOffset + 4;
			for (let channel = 0; channel < source.channels; channel += 1) {
				if (bytes[channelCursor + 2]! > 88) {
					return { faultCode: APU_FAULT_OUTPUT_BLOCK, faultDetail: offset };
				}
				channelCursor += 4;
			}
			if (blockFrames * source.channels > (blockBytes - blockHeaderBytes) * 2) {
				return { faultCode: APU_FAULT_OUTPUT_BLOCK, faultDetail: offset };
			}
			decodedFrames += blockFrames;
			offset = blockEnd;
		}
		while (seekIndex < seekOffsets.length) {
			if (seekFrames[seekIndex]! <= source.frameCount) {
				return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: seekIndex };
			}
			seekIndex += 1;
		}
		return APU_OUTPUT_START_OK;
	}

	private badpLoadBlock(record: ApuOutputVoice, offset: number): void {
		const bytes = record.sourceBytes;
		const badp = record.badp;
		const blockOffset = record.dataOffset + offset;
		const blockFrames = readLE16(bytes, blockOffset);
		const blockBytes = readLE16(bytes, blockOffset + 2);
		const blockHeaderBytes = 4 + record.channels * 4;
		const blockEnd = offset + blockBytes;
		let cursor = blockOffset + 4;
		for (let channel = 0; channel < record.channels; channel += 1) {
			badp.predictors[channel] = readI16LE(bytes, cursor);
			const stepIndex = bytes[cursor + 2]!;
			badp.stepIndices[channel] = stepIndex;
			cursor += 4;
		}
		badp.blockEnd = blockEnd;
		badp.blockFrames = blockFrames;
		badp.blockFrameIndex = 0;
		badp.payloadOffset = offset + blockHeaderBytes;
		badp.nibbleCursor = 0;
	}

	private badpSeekToFrame(record: ApuOutputVoice, frame: number): void {
		const badp = record.badp;
		if (frame === record.frames) {
			badp.nextFrame = frame;
			badp.decodedFrame = frame - 1;
			badp.decodedLeft = 0;
			badp.decodedRight = 0;
			return;
		}
		let seekIndex = 0;
		let lo = 0;
		let hi = record.badpSeekFrames.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (record.badpSeekFrames[mid]! <= frame) {
				seekIndex = mid;
				lo = mid + 1;
			} else {
				if (mid === 0) {
					break;
				}
				hi = mid - 1;
			}
		}
		let currentFrame = record.badpSeekFrames[seekIndex]!;
		let cursor = record.badpSeekOffsets[seekIndex]!;
		this.badpLoadBlock(record, cursor);
		while (currentFrame + badp.blockFrames <= frame) {
			currentFrame += badp.blockFrames;
			cursor = badp.blockEnd;
			this.badpLoadBlock(record, cursor);
		}
		badp.nextFrame = currentFrame;
		badp.decodedFrame = currentFrame - 1;
		while (badp.nextFrame <= frame) {
			this.badpDecodeNextFrame(record);
		}
	}

	private badpResetDecoder(record: ApuOutputVoice, frame: number): void {
		const predictors = record.badp.predictors;
		const stepIndices = record.badp.stepIndices;
		record.badp = {
			predictors,
			stepIndices,
			nextFrame: 0,
			blockEnd: 0,
			blockFrames: 0,
			blockFrameIndex: 0,
			payloadOffset: 0,
			nibbleCursor: 0,
			decodedFrame: -1,
			decodedLeft: 0,
			decodedRight: 0,
		};
		predictors.fill(0);
		stepIndices.fill(0);
		this.badpSeekToFrame(record, frame);
	}

	private badpDecodeNextFrame(record: ApuOutputVoice): void {
		const badp = record.badp;
		if (badp.blockFrameIndex >= badp.blockFrames) {
			this.badpLoadBlock(record, badp.blockEnd);
		}
		let left = 0;
		let right = 0;
		const bytes = record.sourceBytes;
		for (let channel = 0; channel < record.channels; channel += 1) {
			const payloadIndex = record.dataOffset + badp.payloadOffset + (badp.nibbleCursor >> 1);
			const packed = bytes[payloadIndex]!;
			const code = (badp.nibbleCursor & 1) === 0 ? ((packed >> 4) & 0x0f) : (packed & 0x0f);
			badp.nibbleCursor += 1;
			let predictor = badp.predictors[channel]!;
			let stepIndex = badp.stepIndices[channel]!;
			const step = BADP_STEP_TABLE[stepIndex]!;
			let diff = step >> 3;
			if ((code & 4) !== 0) diff += step;
			if ((code & 2) !== 0) diff += step >> 1;
			if ((code & 1) !== 0) diff += step >> 2;
			if ((code & 8) !== 0) {
				predictor -= diff;
			} else {
				predictor += diff;
			}
			predictor = clamp(predictor, -32768, 32767);
			stepIndex += BADP_INDEX_TABLE[code]!;
			stepIndex = clamp(stepIndex, 0, 88);
			badp.predictors[channel] = predictor;
			badp.stepIndices[channel] = stepIndex;
			if (channel === 0) {
				left = predictor;
			} else {
				right = predictor;
			}
		}
		if (record.channels === 1) {
			right = left;
		}
		badp.blockFrameIndex += 1;
		badp.nextFrame += 1;
		badp.decodedFrame = badp.nextFrame - 1;
		badp.decodedLeft = left;
		badp.decodedRight = right;
	}

	private badpReadFrameAt(record: ApuOutputVoice, frame: number): boolean {
		if (frame < 0 || frame >= record.frames) {
			return false;
		}
		const badp = record.badp;
		if (badp.decodedFrame === frame) {
			this.sampledLeft = badp.decodedLeft * PCM_SCALE;
			this.sampledRight = badp.decodedRight * PCM_SCALE;
			return true;
		}
		if (frame < badp.nextFrame) {
			this.badpSeekToFrame(record, frame);
		}
		while (badp.nextFrame <= frame) {
			this.badpDecodeNextFrame(record);
		}
		this.sampledLeft = badp.decodedLeft * PCM_SCALE;
		this.sampledRight = badp.decodedRight * PCM_SCALE;
		return true;
	}
}
