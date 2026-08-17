import { clamp } from '../../../common/clamp';
import { shiftRightSigned, toSignedWord, wrapI32 } from '../../common/numeric';
import { BiquadFilterState, configureBiquadFilter } from './biquad_filter';
import { loadApuBadpSeekTable, type ApuBadpDecoderState, type ApuBadpSeekTable } from './badp_decoder';
import {
	createApuBadpDecoderState,
	readApuBadpFrameAt,
	resetApuBadpDecoder,
} from './badp_decoder_hot_path';
import { ApuOutputRing } from './output_ring';
import { interpolateApuPcmSample, readApuPcmSample } from './pcm_decoder_hot_path';
import { resolveApuPhaseStep, type ApuPhaseStep } from './playback';
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
	APU_GAIN_Q12_FRACTION_BITS,
	APU_GENERATOR_SQUARE,
	APU_SLOT_COUNT,
	APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX,
	APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX,
	APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX,
	APU_PARAMETER_FILTER_B0_B1_INDEX,
	APU_PARAMETER_FILTER_A2_INDEX,
	APU_PARAMETER_FILTER_CONTROL_INDEX,
	APU_PARAMETER_FILTER_B2_A1_INDEX,
	APU_PARAMETER_GAIN_Q12_INDEX,
	APU_PARAMETER_RATE_STEP_Q16_INDEX,
	APU_PARAMETER_START_SAMPLE_INDEX,
	APU_RATE_STEP_Q16_ONE,
	APU_SAMPLE_RATE_HZ,
} from '../../../spec/audio/apu';
import {
	type ApuAudioSlot,
	type ApuAudioSource,
	type ApuParameterRegisterWords,
} from './contracts';

type ApuOutputVoice = ApuOutputVoiceStateAccess & {
	active: boolean;
	resident: boolean;
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
	private readonly mixBuffer = new Float64Array(ApuOutputMixer.MIX_BATCH_SAMPLES);
	private readonly renderBuffer = new Int16Array(ApuOutputMixer.MIX_BATCH_SAMPLES);
	private readonly phaseStep: ApuPhaseStep = { wholeQ16: 0, remainder: 0 };
	private sampledLeft = 0;
	private sampledRight = 0;

	public constructor() {
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			this.voices[slot] = {
				active: false,
				resident: false,
				slot,
				sourceCartridgeSlot: 0,
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
				cursorQ16: 0,
				phaseRemainder: 0,
				phaseStepQ16: 0,
				phaseStepRemainder: 0,
				gainQ12: APU_GAIN_Q12_ONE,
				fadeStepQ12: 0,
				fadeStepRemainder: 0,
				fadeError: 0,
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
			const record = this.voices[slot]!;
			record.active = false;
			record.resident = false;
		}
		this.outputRing.clear();
	}

	public captureState(): ApuOutputState {
		const voices: ApuOutputVoiceState[] = [];
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			const record = this.voices[slot]!;
			if (record.resident) {
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
		record.filter.reset();
		this.configureRecordFilter(record, registerWords);
		this.buildVoiceFromData(
			record,
			source,
			sourceBytes,
			registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX]!,
			registerWords[APU_PARAMETER_START_SAMPLE_INDEX]! * APU_RATE_STEP_Q16_ONE,
			0,
		);
		record.gainQ12 = toSignedWord(registerWords[APU_PARAMETER_GAIN_Q12_INDEX]!);
		record.fadeStepQ12 = 0;
		record.fadeStepRemainder = 0;
		record.fadeError = 0;
		record.fadeSamplesRemaining = 0;
		record.fadeSamplesTotal = 0;
		record.resident = true;
		record.active = true;
	}

	public replaceVoiceSource(
		slot: ApuAudioSlot,
		source: ApuAudioSource,
		sourceBytes: ApuSourceByteView,
		registerWords: ApuParameterRegisterWords,
	): void {
		const record = this.voices[slot]!;
		this.buildVoiceFromData(
			record,
			source,
			sourceBytes,
			registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX]!,
			record.cursorQ16,
			record.phaseRemainder,
		);
		this.configureRecordFilter(record, registerWords);
	}

	public restoreVoice(
		slot: ApuAudioSlot,
		source: ApuAudioSource,
		sourceBytes: ApuSourceByteView,
		registerWords: ApuParameterRegisterWords,
		state: ApuOutputVoiceState,
	): void {
		const record = this.voices[slot]!;
		this.buildVoiceFromData(record, source, sourceBytes, registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX]!, state.cursorQ16, state.phaseRemainder);
		record.filter.reset();
		this.configureRecordFilter(record, registerWords);
		restoreApuOutputVoiceState(record, state);
		record.resident = true;
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
			case APU_PARAMETER_FILTER_CONTROL_INDEX:
			case APU_PARAMETER_FILTER_B0_B1_INDEX:
			case APU_PARAMETER_FILTER_B2_A1_INDEX:
			case APU_PARAMETER_FILTER_A2_INDEX:
				this.configureRecordFilter(record, registerWords);
				return;
			default:
				return;
		}
	}

	public stopSlot(slot: ApuAudioSlot, fadeSamples = 0): void {
		const record = this.voices[slot]!;
		if (fadeSamples !== 0 && record.resident) {
			this.configureFade(record, fadeSamples);
			return;
		}
		record.active = false;
		record.resident = false;
	}

	public pauseSlot(slot: ApuAudioSlot): void {
		this.voices[slot]!.active = false;
	}

	public resumeSlot(slot: ApuAudioSlot): void {
		const record = this.voices[slot]!;
		record.active = record.resident;
	}

	public stopAllVoices(): void {
		for (let slot = 0; slot < APU_SLOT_COUNT; slot += 1) {
			const record = this.voices[slot]!;
			record.active = false;
			record.resident = false;
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
			let gainQ12 = record.gainQ12;
			let fadeError = record.fadeError;
			let fadeRemaining = record.fadeSamplesRemaining;
			const fadeRemainderMagnitude = record.fadeStepRemainder < 0
				? -record.fadeStepRemainder
				: record.fadeStepRemainder;
			const fadeRemainderSign = record.fadeStepRemainder < 0
				? -1
				: (record.fadeStepRemainder > 0 ? 1 : 0);
			let ended = false;

			for (let frame = 0; frame < frameCount; frame += 1) {
				if (hasLoop) {
					cursorQ16 = this.wrapLoopCursor(cursorQ16, record.loopStartQ16, record.loopEndQ16);
				} else if (cursorQ16 < 0 || cursorQ16 >= framesInRecordQ16) {
					ended = true;
					break;
				}

				let leftSample: number;
				let rightSample: number;
				if (record.generatorKind === APU_GENERATOR_SQUARE) {
					const fractionQ16 = cursorQ16 % APU_RATE_STEP_Q16_ONE;
					const sample = fractionQ16 * APU_GAIN_Q12_ONE < record.generatorDutyQ12 * APU_RATE_STEP_Q16_ONE ? 0x7fff : -0x8000;
					leftSample = sample;
					rightSample = sample;
				} else {
					const frameIndex = audioFrameIndex(cursorQ16);
					const fractionQ16 = cursorQ16 % APU_RATE_STEP_Q16_ONE;
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
					leftSample = left0;
					rightSample = right0;
					if (nextFrame !== frameIndex) {
						this.readVoiceFrame(record, nextFrame);
						leftSample = interpolateApuPcmSample(left0, this.sampledLeft, fractionQ16);
						rightSample = interpolateApuPcmSample(right0, this.sampledRight, fractionQ16);
					}
				}
				if (record.filter.enabled) {
					record.filter.processStereo(leftSample, rightSample);
					leftSample = record.filter.outputLeft;
					rightSample = record.filter.outputRight;
				}
				const outIndex = frame * 2;
				mix[outIndex] += leftSample * gainQ12;
				mix[outIndex + 1] += rightSample * gainQ12;

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
					const nextFadeError = fadeError + fadeRemainderMagnitude;
					let fadeRemainderCarry = 0;
					if (nextFadeError >= record.fadeSamplesTotal) {
						fadeError = (nextFadeError - record.fadeSamplesTotal) >>> 0;
						fadeRemainderCarry = fadeRemainderSign;
					} else {
						fadeError = nextFadeError >>> 0;
					}
					gainQ12 = wrapI32(gainQ12 - record.fadeStepQ12 - fadeRemainderCarry);
				} else if (!hasLoop && (cursorQ16 < 0 || cursorQ16 >= framesInRecordQ16)) {
					ended = true;
					break;
				}
			}

			record.cursorQ16 = cursorQ16;
			record.phaseRemainder = phaseRemainder;
			record.gainQ12 = gainQ12;
			record.fadeError = fadeError;
			record.fadeSamplesRemaining = fadeRemaining;
			if (ended) {
				record.active = false;
				record.resident = false;
				endedMask |= 1 << slot;
			}
		}

		const output = this.renderBuffer;
		for (let index = 0; index < totalSamples; index += 1) {
			output[index] = clamp(
				shiftRightSigned(mix[index]!, APU_GAIN_Q12_FRACTION_BITS),
				-0x8000,
				0x7fff,
			);
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
	): void {
		record.sourceCartridgeSlot = sourceBytes.cartridgeSlot;
		record.channels = source.channels;
		record.bitsPerSample = source.bitsPerSample;
		record.sourceBytes = sourceBytes.bytes;
		record.dataOffset = sourceBytes.byteOffset + source.dataOffset;
		record.frames = source.frameCount;
		record.generatorKind = source.generatorKind;
		record.generatorDutyQ12 = source.generatorDutyQ12;
		const usesBadp = !apuAudioSourceUsesGenerator(source) && source.bitsPerSample === 4;
		if (usesBadp) {
			loadApuBadpSeekTable(record.badpSeekTable, sourceBytes.bytes, sourceBytes.byteOffset);
		} else {
			record.badpSeekTable.bytes = EMPTY_SOURCE_BYTES;
			record.badpSeekTable.byteOffset = 0;
			record.badpSeekTable.entryCount = 0;
		}
		record.cursorQ16 = cursorQ16;
		record.phaseRemainder = phaseRemainder;
		this.configurePhaseStep(record, rateStepQ16Word, source.sampleRateHz);
		this.applyVoiceLoopBounds(record, source);
		record.usesBadp = usesBadp;
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
		record.gainQ12 = toSignedWord(gainQ12Word);
		if (record.fadeSamplesRemaining !== 0) {
			this.configureFade(record, record.fadeSamplesRemaining);
		}
	}

	private configureFade(record: ApuOutputVoice, fadeSamples: number): void {
		const remainder = record.gainQ12 % fadeSamples;
		record.fadeStepQ12 = (record.gainQ12 - remainder) / fadeSamples;
		record.fadeStepRemainder = remainder;
		record.fadeError = fadeSamples - 1;
		record.fadeSamplesRemaining = fadeSamples;
		record.fadeSamplesTotal = fadeSamples;
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
			this.sampledLeft = (packed << 16) >> 16;
			this.sampledRight = packed >> 16;
			return;
		}
		const baseSample = frame * record.channels;
		if (record.bitsPerSample === 16) {
			this.sampledLeft = readApuPcmSample(record.sourceBytes, record.dataOffset, true, baseSample);
			this.sampledRight = record.channels === 1 ? this.sampledLeft : readApuPcmSample(record.sourceBytes, record.dataOffset, true, baseSample + 1);
			return;
		}
		this.sampledLeft = readApuPcmSample(record.sourceBytes, record.dataOffset, false, baseSample);
		this.sampledRight = record.channels === 1 ? this.sampledLeft : readApuPcmSample(record.sourceBytes, record.dataOffset, false, baseSample + 1);
	}

	private wrapLoopCursor(cursorQ16: number, loopStartQ16: number, loopEndQ16: number): number {
		const lengthQ16 = loopEndQ16 - loopStartQ16;
		let wrapped = (cursorQ16 - loopStartQ16) % lengthQ16;
		if (wrapped < 0) {
			wrapped += lengthQ16;
		}
		return loopStartQ16 + wrapped;
	}

	private configureRecordFilter(record: ApuOutputVoice, registerWords: ApuParameterRegisterWords): void {
		configureBiquadFilter(
			record.filter,
			registerWords[APU_PARAMETER_FILTER_CONTROL_INDEX]!,
			registerWords[APU_PARAMETER_FILTER_B0_B1_INDEX]!,
			registerWords[APU_PARAMETER_FILTER_B2_A1_INDEX]!,
			registerWords[APU_PARAMETER_FILTER_A2_INDEX]!,
		);
	}

}
