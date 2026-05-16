import { clamp, clamp01 } from '../../../common/clamp';
import { BiquadFilterState, configureBiquadFilter } from './biquad_filter';
import { readApuBadpSeekTable, type ApuBadpDecoderState } from './badp_decoder';
import {
	createApuBadpDecoderState,
	readApuBadpFrameAt,
	resetApuBadpDecoder,
} from './badp_decoder_hot_path';
import { ApuOutputRing } from './output_ring';
import { APU_PCM_SAMPLE_SCALE, readApuPcmSample } from './pcm_decoder_hot_path';
import {
	resolveApuGainLinear,
	resolveApuOutputFilter,
	resolveApuPlaybackRate,
	resolveApuOutputPlayback,
	type ApuOutputPlayback,
} from './playback';
import { apuAudioSourceUsesGenerator } from './source';
import {
	captureApuOutputVoiceState,
	restoreApuOutputVoiceState,
	type ApuOutputState,
	type ApuOutputVoiceStateAccess,
	type ApuOutputVoiceState,
} from './save_state';
import {
	APU_FAULT_NONE,
	APU_FAULT_OUTPUT_METADATA,
	APU_FAULT_OUTPUT_PLAYBACK_RATE,
	APU_GAIN_Q12_ONE,
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
	type ApuAudioSlot,
	type ApuAudioSource,
	type ApuParameterRegisterWords,
	type ApuVoiceId,
} from './contracts';

export interface ApuOutputStartResult {
	faultCode: number;
	faultDetail: number;
}

type ApuOutputVoice = ApuOutputVoiceStateAccess & {
	voiceId: ApuVoiceId;
	sampleRate: number;
	channels: number;
	bitsPerSample: number;
	sourceBytes: Uint8Array;
	dataOffset: number;
	dataSize: number;
	frames: number;
	generatorKind: number;
	generatorDutyQ12: number;
	badpSeekFrames: Uint32Array<ArrayBufferLike>;
	badpSeekOffsets: Uint32Array<ArrayBufferLike>;
	loopStartFrame: number;
	loopEndFrame: number;
	playback: ApuOutputPlayback;
	usesBadp: boolean;
	badp: ApuBadpDecoderState;
};

const MIN_GAIN = 0.0001;
const APU_OUTPUT_START_OK: ApuOutputStartResult = { faultCode: APU_FAULT_NONE, faultDetail: 0 };
const EMPTY_BADP_SEEK_FRAMES = new Uint32Array(0);
const EMPTY_BADP_SEEK_OFFSETS = new Uint32Array(0);
function audioFrameIndex(position: number): number {
	return position - (position % 1);
}

function squareGeneratorSample(position: number, dutyQ12: number): number {
	const frameIndex = audioFrameIndex(position);
	return (position - frameIndex) * APU_GAIN_Q12_ONE < dutyQ12 ? 1 : -1;
}

export class ApuOutputMixer {
	public readonly outputRing = new ApuOutputRing();
	private readonly voices: ApuOutputVoice[] = [];
	private readonly mixBuffer = new Float32Array(APU_OUTPUT_QUEUE_CAPACITY_SAMPLES);
	private sampledLeft = 0;
	private sampledRight = 0;

	public resetPlaybackState(): void {
		this.voices.length = 0;
		this.outputRing.clear();
	}

	public captureState(): ApuOutputState {
		const voices = new Array<ApuOutputVoiceState>(this.voices.length);
		for (let index = 0; index < this.voices.length; index += 1) {
			voices[index] = captureApuOutputVoiceState(this.voices[index]!);
		}
		return { voices };
	}

	public restoreVoiceState(state: ApuOutputVoiceState): void {
		for (let index = this.voices.length - 1; index >= 0; index -= 1) {
			const record = this.voices[index]!;
			if (record.slot !== state.slot) {
				continue;
			}
			restoreApuOutputVoiceState(record, state);
			return;
		}
		throw new Error('[AOUT] Restored voice state has no active AOUT record.');
	}

	public pullOutputFrames(output: Int16Array, frameCount: number, outputSampleRate: number, outputGain: number, targetQueuedFrames = 0): void {
		if (frameCount > APU_OUTPUT_QUEUE_CAPACITY_FRAMES) {
			throw new Error('[AOUT] Host pull exceeds the output-ring capacity.');
		}
		this.fillOutputQueueTo(frameCount, outputSampleRate, outputGain);
		this.outputRing.read(output, frameCount);
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
		let badpSeekFrames: Uint32Array<ArrayBufferLike> = EMPTY_BADP_SEEK_FRAMES;
		let badpSeekOffsets: Uint32Array<ArrayBufferLike> = EMPTY_BADP_SEEK_OFFSETS;
		if (!apuAudioSourceUsesGenerator(source)) {
			if (source.bitsPerSample === 4) {
				const badpSeek = readApuBadpSeekTable(sourceBytes);
				badpSeekFrames = badpSeek.frames;
				badpSeekOffsets = badpSeek.offsets;
			}
		}
		const record = this.buildVoiceFromData(slot, voiceId, source, sourceBytes, badpSeekFrames, badpSeekOffsets, playback, playbackCursorQ16, clamp01(playback.gainLinear));
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
				playbackRate = resolveApuPlaybackRate(rateStepQ16Word);
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
		if (targetFrames > APU_OUTPUT_QUEUE_CAPACITY_FRAMES) {
			targetFrames = APU_OUTPUT_QUEUE_CAPACITY_FRAMES;
		}
		const framesToRender = targetFrames - this.outputRing.queuedFrames();
		if (framesToRender <= 0) {
			return;
		}
		this.renderSamples(this.outputRing.renderBuffer, framesToRender, outputSampleRate, outputGain);
		this.outputRing.write(this.outputRing.renderBuffer, framesToRender);
	}

	private buildVoiceFromData(
		slot: ApuAudioSlot,
		voiceId: ApuVoiceId,
		source: ApuAudioSource,
		sourceBytes: Uint8Array,
		badpSeekFrames: Uint32Array<ArrayBufferLike>,
		badpSeekOffsets: Uint32Array<ArrayBufferLike>,
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
			badp: createApuBadpDecoderState(),
		};
		if (record.usesBadp) {
			resetApuBadpDecoder(record, audioFrameIndex(record.position));
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
			resetApuBadpDecoder(record, startFrame);
		}
	}

	private readVoiceFrame(record: ApuOutputVoice, frame: number): boolean {
		if (record.usesBadp) {
			if (!readApuBadpFrameAt(record, frame)) {
				return false;
			}
			this.sampledLeft = record.badp.decodedLeft * APU_PCM_SAMPLE_SCALE;
			this.sampledRight = record.badp.decodedRight * APU_PCM_SAMPLE_SCALE;
			return true;
		}
		if (frame < 0 || frame >= record.frames) {
			return false;
		}
		const baseSample = frame * record.channels;
		if (record.bitsPerSample === 16) {
			this.sampledLeft = readApuPcmSample(record.sourceBytes, record.dataOffset, true, baseSample) * APU_PCM_SAMPLE_SCALE;
			this.sampledRight = record.channels === 1 ? this.sampledLeft : readApuPcmSample(record.sourceBytes, record.dataOffset, true, baseSample + 1) * APU_PCM_SAMPLE_SCALE;
			return true;
		}
		this.sampledLeft = readApuPcmSample(record.sourceBytes, record.dataOffset, false, baseSample) * APU_PCM_SAMPLE_SCALE;
		this.sampledRight = record.channels === 1 ? this.sampledLeft : readApuPcmSample(record.sourceBytes, record.dataOffset, false, baseSample + 1) * APU_PCM_SAMPLE_SCALE;
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

}
