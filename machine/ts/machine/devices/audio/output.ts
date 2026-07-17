import { clamp, clamp01 } from '../../../common/clamp';
import { BiquadFilterState, configureBiquadFilter } from './biquad_filter';
import { loadApuBadpSeekTable, type ApuBadpDecoderState, type ApuBadpSeekTable } from './badp_decoder';
import {
	createApuBadpDecoderState,
	readApuBadpFrameAt,
	resetApuBadpDecoder,
} from './badp_decoder_hot_path';
import { ApuOutputRing } from './output_ring';
import { APU_PCM_SAMPLE_SCALE, readApuPcmSample } from './pcm_decoder_hot_path';
import {
	applyApuOutputFilter,
	loadApuOutputPlayback,
	resolveApuGainLinear,
	resolveApuPhaseStep,
	type ApuPhaseStep,
	type ApuOutputPlayback,
} from './playback';
import { apuAudioSourceUsesGenerator, type ApuSourceByteView } from './source';
import {
	captureApuOutputVoiceState,
	restoreApuOutputVoiceState,
	type ApuOutputState,
	type ApuOutputVoiceStateAccess,
	type ApuOutputVoiceState,
} from './save_state';
import {
	APU_GAIN_Q12_ONE,
	APU_GENERATOR_SQUARE,
	APU_SLOT_COUNT,
	APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX,
	APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX,
	APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX,
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
} from './contracts';

type ApuOutputVoice = ApuOutputVoiceStateAccess & {
	active: boolean;
	channels: number;
	bitsPerSample: number;
	sourceBytes: Uint8Array;
	dataOffset: number;
	frames: number;
	generatorKind: number;
	generatorDutyQ12: number;
	badpSeekTable: ApuBadpSeekTable;
	loopStartQ16: number;
	loopEndQ16: number;
	playback: ApuOutputPlayback;
	phaseStepQ16: number;
	phaseStepRemainder: number;
	usesBadp: boolean;
	badp: ApuBadpDecoderState;
};

const EMPTY_SOURCE_BYTES = new Uint8Array(0);

function audioFrameIndex(cursorQ16: number): number {
	return (cursorQ16 - (cursorQ16 % APU_RATE_STEP_Q16_ONE)) / APU_RATE_STEP_Q16_ONE;
}

export class ApuOutputMixer {
	public static readonly MIX_BATCH_FRAMES = 128;
	private static readonly MIX_BATCH_SAMPLES = ApuOutputMixer.MIX_BATCH_FRAMES * 2;
	public readonly outputRing = new ApuOutputRing();
	private readonly voices: ApuOutputVoice[] = [];
	private readonly mixBuffer = new Float32Array(ApuOutputMixer.MIX_BATCH_SAMPLES);
	private readonly renderBuffer = new Int16Array(ApuOutputMixer.MIX_BATCH_SAMPLES);
	private readonly phaseStep: ApuPhaseStep = { wholeQ16: 0, remainder: 0 };
	private sampledLeft = 0;
	private sampledRight = 0;

	public constructor() {
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			this.voices[slot] = {
				active: false,
				slot,
				channels: 0,
				bitsPerSample: 0,
				sourceBytes: EMPTY_SOURCE_BYTES,
				dataOffset: 0,
				frames: 0,
				generatorKind: 0,
				generatorDutyQ12: 0,
				badpSeekTable: {
					bytes: EMPTY_SOURCE_BYTES,
					byteOffset: 0,
					entryCount: 0,
				},
				loopStartQ16: -1,
				loopEndQ16: -1,
				playback: {
					gainLinear: 1,
					filterEnabled: false,
					filterType: 'lowpass',
					filterFrequency: 0,
					filterQ: 0,
					filterGain: 0,
				},
				cursorQ16: 0,
				phaseRemainder: 0,
				phaseStepQ16: 0,
				phaseStepRemainder: 0,
				gain: 1,
				fadeStartGain: 1,
				fadeSamplesRemaining: 0,
				fadeSamplesTotal: 0,
				filter: new BiquadFilterState(),
				usesBadp: false,
				badp: createApuBadpDecoderState(),
			};
		}
	}

	public resetPlaybackState(): void {
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			this.voices[slot]!.active = false;
		}
		this.outputRing.clear();
	}

	public captureState(): ApuOutputState {
		const voices: ApuOutputVoiceState[] = [];
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			const record = this.voices[slot]!;
			if (record.active) {
				voices.push(captureApuOutputVoiceState(record));
			}
		}
		return { voices };
	}

	public playVoice(
		slot: ApuAudioSlot,
		source: ApuAudioSource,
		sourceBytes: ApuSourceByteView,
		registerWords: ApuParameterRegisterWords,
	): void {
		const record = this.voices[slot]!;
		loadApuOutputPlayback(record.playback, registerWords);
		this.buildVoiceFromData(
			record,
			source,
			sourceBytes,
			registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX]!,
			registerWords[APU_PARAMETER_START_SAMPLE_INDEX]! * APU_RATE_STEP_Q16_ONE,
			0,
			clamp01(record.playback.gainLinear),
		);
	}

	public replaceVoiceSource(
		slot: ApuAudioSlot,
		source: ApuAudioSource,
		sourceBytes: ApuSourceByteView,
		registerWords: ApuParameterRegisterWords,
	): void {
		const record = this.voices[slot]!;
		const cursorQ16 = record.cursorQ16;
		const phaseRemainder = record.phaseRemainder;
		const fadeStartGain = record.fadeStartGain;
		const fadeSamplesRemaining = record.fadeSamplesRemaining;
		const fadeSamplesTotal = record.fadeSamplesTotal;
		loadApuOutputPlayback(record.playback, registerWords);
		this.buildVoiceFromData(record, source, sourceBytes, registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX]!, cursorQ16, phaseRemainder, record.gain);
		record.fadeStartGain = fadeStartGain;
		record.fadeSamplesRemaining = fadeSamplesRemaining;
		record.fadeSamplesTotal = fadeSamplesTotal;
	}

	public restoreVoice(
		slot: ApuAudioSlot,
		source: ApuAudioSource,
		sourceBytes: ApuSourceByteView,
		registerWords: ApuParameterRegisterWords,
		state: ApuOutputVoiceState,
	): void {
		const record = this.voices[slot]!;
		loadApuOutputPlayback(record.playback, registerWords);
		this.buildVoiceFromData(record, source, sourceBytes, registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX]!, state.cursorQ16, state.phaseRemainder, state.gain);
		restoreApuOutputVoiceState(record, state);
		record.active = true;
	}

	public writeSlotRegisterWord(slot: ApuAudioSlot, source: ApuAudioSource, registerWords: ApuParameterRegisterWords, parameterIndex: number): void {
		const record = this.voices[slot]!;
		switch (parameterIndex) {
			case APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX:
			case APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX:
				this.applyVoiceLoopBounds(record, source);
				return;
			case APU_PARAMETER_RATE_STEP_Q16_INDEX:
				this.configurePhaseStep(record, registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX]!, source.sampleRateHz);
				return;
			case APU_PARAMETER_GAIN_Q12_INDEX:
				this.applyVoiceGainQ12(record, registerWords[APU_PARAMETER_GAIN_Q12_INDEX]!);
				return;
			case APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX:
				record.generatorDutyQ12 = source.generatorDutyQ12;
				return;
			case APU_PARAMETER_START_SAMPLE_INDEX:
				this.seekVoice(record, registerWords[APU_PARAMETER_START_SAMPLE_INDEX]!);
				return;
			case APU_PARAMETER_FILTER_KIND_INDEX:
			case APU_PARAMETER_FILTER_FREQ_HZ_INDEX:
			case APU_PARAMETER_FILTER_Q_MILLI_INDEX:
			case APU_PARAMETER_FILTER_GAIN_MILLIDB_INDEX:
				applyApuOutputFilter(record.playback, registerWords);
				this.configureRecordFilter(record);
				return;
			default:
				return;
		}
	}

	public stopSlot(slot: ApuAudioSlot, fadeSamples = 0): void {
		const record = this.voices[slot]!;
		if (fadeSamples !== 0 && record.active) {
			record.fadeStartGain = record.gain;
			record.fadeSamplesRemaining = fadeSamples;
			record.fadeSamplesTotal = fadeSamples;
			return;
		}
		record.active = false;
	}

	public stopAllVoices(): void {
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			this.voices[slot]!.active = false;
		}
	}

	public samplesUntilNextEvent(limit: number): number {
		let earliest = limit;
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			const record = this.voices[slot]!;
			if (!record.active) {
				continue;
			}
			if (record.fadeSamplesRemaining !== 0 && record.fadeSamplesRemaining < earliest) {
				earliest = record.fadeSamplesRemaining;
			}
			if (record.loopEndQ16 > record.loopStartQ16) {
				continue;
			}
			const frameEndQ16 = record.frames * APU_RATE_STEP_Q16_ONE;
			let cursorQ16 = record.cursorQ16;
			let phaseRemainder = record.phaseRemainder;
			if (cursorQ16 < 0 || cursorQ16 >= frameEndQ16) {
				return 1;
			}
			const stepDirection = record.phaseStepQ16 !== 0 ? record.phaseStepQ16 : record.phaseStepRemainder;
			if (stepDirection === 0) {
				continue;
			}
			if (stepDirection > 0) {
				const maximumAdvance = record.phaseStepQ16 + (record.phaseStepRemainder === 0 ? 0 : 1);
				if (maximumAdvance <= (frameEndQ16 - cursorQ16 - 1) / earliest) {
					continue;
				}
			} else {
				const maximumRetreat = -record.phaseStepQ16 + (record.phaseStepRemainder === 0 ? 0 : 1);
				if (maximumRetreat <= cursorQ16 / earliest) {
					continue;
				}
			}
			for (let sample = 1; sample <= earliest; sample += 1) {
				phaseRemainder += record.phaseStepRemainder;
				let phaseCarry = 0;
				if (phaseRemainder >= APU_SAMPLE_RATE_HZ) {
					phaseRemainder -= APU_SAMPLE_RATE_HZ;
					phaseCarry = 1;
				} else if (phaseRemainder <= -APU_SAMPLE_RATE_HZ) {
					phaseRemainder += APU_SAMPLE_RATE_HZ;
					phaseCarry = -1;
				}
				cursorQ16 += record.phaseStepQ16 + phaseCarry;
				if (cursorQ16 < 0 || cursorQ16 >= frameEndQ16) {
					earliest = sample;
					break;
				}
			}
		}
		return earliest;
	}

	public renderMachineFrames(frameCount: number, startSequence: number): number {
		let endedMask = 0;
		let remaining = frameCount;
		let batchSequence = startSequence;
		while (remaining !== 0) {
			const batchFrames = remaining < ApuOutputMixer.MIX_BATCH_FRAMES ? remaining : ApuOutputMixer.MIX_BATCH_FRAMES;
			endedMask |= this.renderMachineBatch(batchFrames, batchSequence);
			batchSequence += batchFrames;
			remaining -= batchFrames;
		}
		return endedMask >>> 0;
	}

	private renderMachineBatch(frameCount: number, startSequence: number): number {
		const totalSamples = frameCount * 2;
		this.mixBuffer.fill(0, 0, totalSamples);
		let endedMask = 0;
		const mix = this.mixBuffer;

		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			const record = this.voices[slot]!;
			if (!record.active) {
				continue;
			}
			const framesInRecordQ16 = record.frames * APU_RATE_STEP_Q16_ONE;
			const hasLoop = record.loopEndQ16 > record.loopStartQ16;
			let cursorQ16 = record.cursorQ16;
			let phaseRemainder = record.phaseRemainder;
			let gain = record.gain;
			let fadeRemaining = record.fadeSamplesRemaining;
			let ended = false;

			for (let frame = 0; frame < frameCount; frame += 1) {
				if (hasLoop) {
					cursorQ16 = this.wrapLoopCursor(cursorQ16, record.loopStartQ16, record.loopEndQ16);
				} else if (cursorQ16 < 0 || cursorQ16 >= framesInRecordQ16) {
					ended = true;
					break;
				}

				if (fadeRemaining !== 0) {
					gain = record.fadeStartGain * fadeRemaining / record.fadeSamplesTotal;
				}
				let left: number;
				let right: number;
				if (record.generatorKind === APU_GENERATOR_SQUARE) {
					const fractionQ16 = cursorQ16 % APU_RATE_STEP_Q16_ONE;
					const sample = fractionQ16 * APU_GAIN_Q12_ONE < record.generatorDutyQ12 * APU_RATE_STEP_Q16_ONE ? 1 : -1;
					left = sample;
					right = sample;
				} else {
					const frameIndex = audioFrameIndex(cursorQ16);
					const fraction = (cursorQ16 % APU_RATE_STEP_Q16_ONE) / APU_RATE_STEP_Q16_ONE;
					let nextFrame = frameIndex + 1;
					if (hasLoop) {
						const loopEndFrame = record.loopEndQ16 / APU_RATE_STEP_Q16_ONE;
						if (nextFrame >= loopEndFrame) {
							nextFrame = record.loopStartQ16 / APU_RATE_STEP_Q16_ONE;
						}
					} else if (nextFrame >= record.frames) {
						nextFrame = frameIndex;
					}
					this.readVoiceFrame(record, frameIndex);
					const left0 = this.sampledLeft;
					const right0 = this.sampledRight;
					left = left0;
					right = right0;
					if (nextFrame !== frameIndex) {
						this.readVoiceFrame(record, nextFrame);
						left = left0 + (this.sampledLeft - left0) * fraction;
						right = right0 + (this.sampledRight - right0) * fraction;
					}
				}
				if (record.filter.enabled) {
					record.filter.processStereo(left, right);
					left = record.filter.outputLeft;
					right = record.filter.outputRight;
				}
				const outIndex = frame * 2;
				mix[outIndex] += left * gain;
				mix[outIndex + 1] += right * gain;

				phaseRemainder += record.phaseStepRemainder;
				let phaseCarry = 0;
				if (phaseRemainder >= APU_SAMPLE_RATE_HZ) {
					phaseRemainder -= APU_SAMPLE_RATE_HZ;
					phaseCarry = 1;
				} else if (phaseRemainder <= -APU_SAMPLE_RATE_HZ) {
					phaseRemainder += APU_SAMPLE_RATE_HZ;
					phaseCarry = -1;
				}
				cursorQ16 += record.phaseStepQ16 + phaseCarry;
				if (hasLoop) {
					cursorQ16 = this.wrapLoopCursor(cursorQ16, record.loopStartQ16, record.loopEndQ16);
				}
				if (fadeRemaining !== 0) {
					fadeRemaining -= 1;
					if (fadeRemaining === 0) {
						ended = true;
						break;
					}
				} else if (!hasLoop && (cursorQ16 < 0 || cursorQ16 >= framesInRecordQ16)) {
					ended = true;
					break;
				}
			}

			record.cursorQ16 = cursorQ16;
			record.phaseRemainder = phaseRemainder;
			record.gain = gain;
			record.fadeSamplesRemaining = fadeRemaining;
			if (ended) {
				record.active = false;
				endedMask |= 1 << slot;
			}
		}

		const output = this.renderBuffer;
		for (let index = 0; index < totalSamples; index += 1) {
			output[index] = Math.round(clamp(mix[index]!, -1, 1) * 32767);
		}
		this.outputRing.write(output, frameCount, startSequence);
		return endedMask >>> 0;
	}

	private buildVoiceFromData(
		record: ApuOutputVoice,
		source: ApuAudioSource,
		sourceBytes: ApuSourceByteView,
		rateStepQ16Word: number,
		cursorQ16: number,
		phaseRemainder: number,
		initialGain: number,
	): void {
		record.active = true;
		record.channels = source.channels;
		record.bitsPerSample = source.bitsPerSample;
		record.sourceBytes = sourceBytes.bytes;
		record.dataOffset = sourceBytes.byteOffset + source.dataOffset;
		record.frames = source.frameCount;
		record.generatorKind = source.generatorKind;
		record.generatorDutyQ12 = source.generatorDutyQ12;
		if (!apuAudioSourceUsesGenerator(source) && source.bitsPerSample === 4) {
			loadApuBadpSeekTable(record.badpSeekTable, sourceBytes.bytes, sourceBytes.byteOffset);
		} else {
			record.badpSeekTable.bytes = EMPTY_SOURCE_BYTES;
			record.badpSeekTable.byteOffset = 0;
			record.badpSeekTable.entryCount = 0;
		}
		record.cursorQ16 = cursorQ16;
		record.phaseRemainder = phaseRemainder;
		this.configurePhaseStep(record, rateStepQ16Word, source.sampleRateHz);
		record.gain = initialGain;
		record.fadeStartGain = initialGain;
		record.fadeSamplesRemaining = 0;
		record.fadeSamplesTotal = 0;
		record.filter.reset();
		this.applyVoiceLoopBounds(record, source);
		this.configureRecordFilter(record);
		record.usesBadp = !apuAudioSourceUsesGenerator(source) && source.bitsPerSample === 4;
		if (record.usesBadp) {
			resetApuBadpDecoder(record, audioFrameIndex(record.cursorQ16));
		}
	}

	private configurePhaseStep(record: ApuOutputVoice, rateStepQ16Word: number, sampleRateHz: number): void {
		resolveApuPhaseStep(this.phaseStep, rateStepQ16Word, sampleRateHz);
		record.phaseStepQ16 = this.phaseStep.wholeQ16;
		record.phaseStepRemainder = this.phaseStep.remainder;
	}

	private applyVoiceGainQ12(record: ApuOutputVoice, gainQ12Word: number): void {
		const gain = clamp01(resolveApuGainLinear(gainQ12Word));
		record.playback.gainLinear = gain;
		if (record.fadeSamplesRemaining !== 0) {
			record.fadeStartGain = gain;
			record.gain = gain * record.fadeSamplesRemaining / record.fadeSamplesTotal;
			return;
		}
		record.gain = gain;
		record.fadeStartGain = gain;
	}

	private applyVoiceLoopBounds(record: ApuOutputVoice, source: ApuAudioSource): void {
		if (source.loopEndSample > source.loopStartSample) {
			record.loopStartQ16 = source.loopStartSample * APU_RATE_STEP_Q16_ONE;
			record.loopEndQ16 = source.loopEndSample * APU_RATE_STEP_Q16_ONE;
			return;
		}
		record.loopStartQ16 = -1;
		record.loopEndQ16 = -1;
	}

	private seekVoice(record: ApuOutputVoice, startFrame: number): void {
		record.cursorQ16 = startFrame * APU_RATE_STEP_Q16_ONE;
		record.phaseRemainder = 0;
		if (record.usesBadp) {
			resetApuBadpDecoder(record, startFrame);
		}
	}

	private readVoiceFrame(record: ApuOutputVoice, frame: number): void {
		if (record.usesBadp) {
			const packed = readApuBadpFrameAt(record, frame);
			this.sampledLeft = ((packed << 16) >> 16) * APU_PCM_SAMPLE_SCALE;
			this.sampledRight = (packed >> 16) * APU_PCM_SAMPLE_SCALE;
			return;
		}
		const baseSample = frame * record.channels;
		if (record.bitsPerSample === 16) {
			this.sampledLeft = readApuPcmSample(record.sourceBytes, record.dataOffset, true, baseSample) * APU_PCM_SAMPLE_SCALE;
			this.sampledRight = record.channels === 1 ? this.sampledLeft : readApuPcmSample(record.sourceBytes, record.dataOffset, true, baseSample + 1) * APU_PCM_SAMPLE_SCALE;
			return;
		}
		this.sampledLeft = readApuPcmSample(record.sourceBytes, record.dataOffset, false, baseSample) * APU_PCM_SAMPLE_SCALE;
		this.sampledRight = record.channels === 1 ? this.sampledLeft : readApuPcmSample(record.sourceBytes, record.dataOffset, false, baseSample + 1) * APU_PCM_SAMPLE_SCALE;
	}

	private wrapLoopCursor(cursorQ16: number, loopStartQ16: number, loopEndQ16: number): number {
		const lengthQ16 = loopEndQ16 - loopStartQ16;
		let wrapped = (cursorQ16 - loopStartQ16) % lengthQ16;
		if (wrapped < 0) {
			wrapped += lengthQ16;
		}
		return loopStartQ16 + wrapped;
	}

	private configureRecordFilter(record: ApuOutputVoice): void {
		if (!record.playback.filterEnabled) {
			record.filter.reset();
			return;
		}
		configureBiquadFilter(
			record.filter,
			record.playback.filterType,
			record.playback.filterFrequency,
			record.playback.filterQ,
			record.playback.filterGain,
			APU_SAMPLE_RATE_HZ,
		);
	}


}
