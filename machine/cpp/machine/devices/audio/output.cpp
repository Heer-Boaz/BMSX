/*
 * output.cpp - Fixed-rate APU sample generation and output-ring production.
 */

#include "machine/devices/audio/output.h"

#include "common/clamp.h"
#include "machine/common/numeric.h"
#include "machine/devices/audio/badp_decoder_hot_path.h"
#include "machine/devices/audio/pcm_decoder_hot_path.h"
#include "machine/devices/audio/source.h"

#include <algorithm>

namespace bmsx {
namespace {

inline auto audioFrameIndex(i64 cursorQ16) -> i64 {
	return cursorQ16 / static_cast<i64>(APU_RATE_STEP_Q16_ONE);
}

} // namespace

ApuOutputMixer::ApuOutputMixer() {
	for (ApuAudioSlot slot = 0; slot < APU_SLOT_COUNT; slot += 1u) {
		VoiceRecord& record = m_voices[slot];
		record.slot = slot;
	}
}

void ApuOutputMixer::resetPlaybackState() {
	for (VoiceRecord& record : m_voices) {
		record.active = false;
	}
	outputRing.clear();
}

void ApuOutputMixer::playVoice(
	ApuAudioSlot slot,
	const ApuAudioSource& source,
	const ApuSourceByteView& sourceBytes,
	const ApuParameterRegisterWords& registerWords
) {
	VoiceRecord& record = m_voices[slot];
	record.filter.reset();
	configureRecordFilter(record, registerWords);
	buildVoiceFromData(
		record,
		source,
		sourceBytes,
		registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX],
		static_cast<i64>(registerWords[APU_PARAMETER_START_SAMPLE_INDEX]) * static_cast<i64>(APU_RATE_STEP_Q16_ONE),
		0
	);
	record.gainQ12 = toSignedWord(registerWords[APU_PARAMETER_GAIN_Q12_INDEX]);
	record.fadeStepQ12 = 0;
	record.fadeStepRemainder = 0;
	record.fadeError = 0u;
	record.fadeSamplesRemaining = 0u;
	record.fadeSamplesTotal = 0u;
}

void ApuOutputMixer::replaceVoiceSource(
	ApuAudioSlot slot,
	const ApuAudioSource& source,
	const ApuSourceByteView& sourceBytes,
	const ApuParameterRegisterWords& registerWords
) {
	VoiceRecord& record = m_voices[slot];
	buildVoiceFromData(
		record,
		source,
		sourceBytes,
		registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX],
		record.cursorQ16,
		record.phaseRemainder
	);
	configureRecordFilter(record, registerWords);
}

void ApuOutputMixer::restoreVoice(
	ApuAudioSlot slot,
	const ApuAudioSource& source,
	const ApuSourceByteView& sourceBytes,
	const ApuParameterRegisterWords& registerWords,
	const ApuOutputVoiceState& state
) {
	VoiceRecord& record = m_voices[slot];
	buildVoiceFromData(
		record,
		source,
		sourceBytes,
		registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX],
		state.cursorQ16,
		state.phaseRemainder
	);
	record.filter.reset();
	configureRecordFilter(record, registerWords);
	restoreApuOutputVoiceState(record, state);
	record.active = true;
}

void ApuOutputMixer::writeSlotRegisterWord(
	ApuAudioSlot slot,
	const ApuAudioSource& source,
	const ApuParameterRegisterWords& registerWords,
	u32 parameterIndex
) {
	VoiceRecord& record = m_voices[slot];
	switch (parameterIndex) {
		case APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX:
		case APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX:
			applyVoiceLoopBounds(record, source);
			return;
		case APU_PARAMETER_RATE_STEP_Q16_INDEX:
			configurePhaseStep(record, registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX], source.sampleRateHz);
			return;
		case APU_PARAMETER_GAIN_Q12_INDEX:
			applyVoiceGainQ12(record, registerWords[APU_PARAMETER_GAIN_Q12_INDEX]);
			return;
		case APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX:
			record.generatorDutyQ12 = source.generatorDutyQ12;
			return;
		case APU_PARAMETER_START_SAMPLE_INDEX:
			seekVoice(record, registerWords[APU_PARAMETER_START_SAMPLE_INDEX]);
			return;
		case APU_PARAMETER_FILTER_CONTROL_INDEX:
		case APU_PARAMETER_FILTER_B0_B1_INDEX:
		case APU_PARAMETER_FILTER_B2_A1_INDEX:
		case APU_PARAMETER_FILTER_A2_INDEX:
			configureRecordFilter(record, registerWords);
			return;
		default:
			return;
	}
}

void ApuOutputMixer::stopSlot(ApuAudioSlot slot, u32 fadeSamples) {
	VoiceRecord& record = m_voices[slot];
	if (fadeSamples != 0u && record.active) {
		configureFade(record, fadeSamples);
		return;
	}
	record.active = false;
}

void ApuOutputMixer::stopAllVoices() {
	for (VoiceRecord& record : m_voices) {
		record.active = false;
	}
}

i64 ApuOutputMixer::samplesUntilNextEvent(i64 limit) const {
	i64 earliest = limit;
	for (const VoiceRecord& record : m_voices) {
		if (!record.active) {
			continue;
		}
		if (record.fadeSamplesRemaining != 0u && static_cast<i64>(record.fadeSamplesRemaining) < earliest) {
			earliest = record.fadeSamplesRemaining;
		}
		if (record.loopEndQ16 > record.loopStartQ16) {
			continue;
		}
		const i64 frameEndQ16 = static_cast<i64>(record.frames) * static_cast<i64>(APU_RATE_STEP_Q16_ONE);
		i64 cursorQ16 = record.cursorQ16;
		i32 phaseRemainder = record.phaseRemainder;
		if (cursorQ16 < 0 || cursorQ16 >= frameEndQ16) {
			return 1;
		}
		if (record.phaseStepQ16 == 0 && record.phaseStepRemainder == 0) {
			continue;
		}
		if (record.phaseStepQ16 > 0 || record.phaseStepRemainder > 0) {
			const i64 maxAdvance = record.phaseStepQ16 + (record.phaseStepRemainder != 0 ? 1 : 0);
			const i64 distanceToEnd = frameEndQ16 - cursorQ16;
			if (maxAdvance <= (distanceToEnd - 1) / earliest) {
				continue;
			}
		} else {
			const i64 maxRetreat = -record.phaseStepQ16 + (record.phaseStepRemainder != 0 ? 1 : 0);
			if (maxRetreat <= cursorQ16 / earliest) {
				continue;
			}
		}
		for (i64 sample = 1; sample <= earliest; sample += 1) {
			phaseRemainder += record.phaseStepRemainder;
			i32 phaseCarry = 0;
			if (phaseRemainder >= static_cast<i32>(APU_SAMPLE_RATE_HZ)) {
				phaseRemainder -= static_cast<i32>(APU_SAMPLE_RATE_HZ);
				phaseCarry = 1;
			} else if (phaseRemainder <= -static_cast<i32>(APU_SAMPLE_RATE_HZ)) {
				phaseRemainder += static_cast<i32>(APU_SAMPLE_RATE_HZ);
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

u32 ApuOutputMixer::renderMachineFrames(i64 frameCount, i64 startSequence) {
	u32 endedMask = 0u;
	i64 remaining = frameCount;
	i64 batchSequence = startSequence;
	while (remaining != 0) {
		const size_t batchFrames = static_cast<size_t>(std::min<i64>(remaining, MIX_BATCH_FRAMES));
		endedMask |= renderMachineBatch(batchFrames, batchSequence);
		batchSequence += static_cast<i64>(batchFrames);
		remaining -= static_cast<i64>(batchFrames);
	}
	return endedMask;
}

u32 ApuOutputMixer::renderMachineBatch(size_t frameCount, i64 startSequence) {
	const size_t totalSamples = frameCount * 2u;
	std::fill_n(m_mixBuffer.data(), totalSamples, 0);
	u32 endedMask = 0u;
	i64* mix = m_mixBuffer.data();

	for (ApuAudioSlot slot = 0; slot < APU_SLOT_COUNT; slot += 1u) {
		VoiceRecord& record = m_voices[slot];
		if (!record.active) {
			continue;
		}
		const i64 framesInRecordQ16 = static_cast<i64>(record.frames) * static_cast<i64>(APU_RATE_STEP_Q16_ONE);
		const bool hasLoop = record.loopEndQ16 > record.loopStartQ16;
		i64 cursorQ16 = record.cursorQ16;
		i32 phaseRemainder = record.phaseRemainder;
		i32 gainQ12 = record.gainQ12;
		u32 fadeError = record.fadeError;
		u32 fadeRemaining = record.fadeSamplesRemaining;
		const u64 fadeRemainderMagnitude = record.fadeStepRemainder < 0
			? static_cast<u64>(-static_cast<i64>(record.fadeStepRemainder))
			: static_cast<u64>(record.fadeStepRemainder);
		const i32 fadeRemainderSign = record.fadeStepRemainder < 0
			? -1
			: (record.fadeStepRemainder > 0 ? 1 : 0);
		bool ended = false;

		for (size_t frame = 0; frame < frameCount; frame += 1u) {
			if (hasLoop) {
				cursorQ16 = wrapLoopCursor(cursorQ16, record.loopStartQ16, record.loopEndQ16);
			} else if (cursorQ16 < 0 || cursorQ16 >= framesInRecordQ16) {
				ended = true;
				break;
			}

			i32 leftSample = 0;
			i32 rightSample = 0;
			if (record.generatorKind == APU_GENERATOR_SQUARE) {
				const i64 fractionQ16 = cursorQ16 % static_cast<i64>(APU_RATE_STEP_Q16_ONE);
				const i32 sample = fractionQ16 * static_cast<i64>(APU_GAIN_Q12_ONE)
					< static_cast<i64>(record.generatorDutyQ12) * static_cast<i64>(APU_RATE_STEP_Q16_ONE)
					? 0x7fff
					: -0x8000;
				leftSample = sample;
				rightSample = sample;
			} else {
				const i64 frameIndex = audioFrameIndex(cursorQ16);
				const u32 fractionQ16 = static_cast<u32>(cursorQ16 % static_cast<i64>(APU_RATE_STEP_Q16_ONE));
				i64 nextFrame = frameIndex + 1;
				if (hasLoop) {
					const i64 loopEndFrame = record.loopEndQ16 / static_cast<i64>(APU_RATE_STEP_Q16_ONE);
					if (nextFrame >= loopEndFrame) {
						nextFrame = record.loopStartQ16 / static_cast<i64>(APU_RATE_STEP_Q16_ONE);
					}
				} else if (nextFrame >= static_cast<i64>(record.frames)) {
					nextFrame = frameIndex;
				}
				readVoiceFrame(record, static_cast<size_t>(frameIndex));
				const i32 left0 = m_sampledLeft;
				const i32 right0 = m_sampledRight;
				leftSample = left0;
				rightSample = right0;
				if (nextFrame != frameIndex) {
					readVoiceFrame(record, static_cast<size_t>(nextFrame));
					leftSample = interpolateApuPcmSample(left0, m_sampledLeft, fractionQ16);
					rightSample = interpolateApuPcmSample(right0, m_sampledRight, fractionQ16);
				}
			}
			if (record.filter.enabled) {
				record.filter.processStereo(leftSample, rightSample);
				leftSample = record.filter.outputLeft;
				rightSample = record.filter.outputRight;
			}
			const size_t outIndex = frame * 2u;
			mix[outIndex] += static_cast<i64>(leftSample) * static_cast<i64>(gainQ12);
			mix[outIndex + 1u] += static_cast<i64>(rightSample) * static_cast<i64>(gainQ12);

			phaseRemainder += record.phaseStepRemainder;
			i32 phaseCarry = 0;
			if (phaseRemainder >= static_cast<i32>(APU_SAMPLE_RATE_HZ)) {
				phaseRemainder -= static_cast<i32>(APU_SAMPLE_RATE_HZ);
				phaseCarry = 1;
			} else if (phaseRemainder <= -static_cast<i32>(APU_SAMPLE_RATE_HZ)) {
				phaseRemainder += static_cast<i32>(APU_SAMPLE_RATE_HZ);
				phaseCarry = -1;
			}
			cursorQ16 += record.phaseStepQ16 + phaseCarry;
			if (hasLoop) {
				cursorQ16 = wrapLoopCursor(cursorQ16, record.loopStartQ16, record.loopEndQ16);
			}
			if (fadeRemaining != 0u) {
				fadeRemaining -= 1u;
				if (fadeRemaining == 0u) {
					ended = true;
					break;
				}
				const u64 nextFadeError = static_cast<u64>(fadeError) + fadeRemainderMagnitude;
				i32 fadeRemainderCarry = 0;
				if (nextFadeError >= record.fadeSamplesTotal) {
					fadeError = static_cast<u32>(nextFadeError - record.fadeSamplesTotal);
					fadeRemainderCarry = fadeRemainderSign;
				} else {
					fadeError = static_cast<u32>(nextFadeError);
				}
				gainQ12 = wrapI32(
					static_cast<i64>(gainQ12)
					- static_cast<i64>(record.fadeStepQ12)
					- static_cast<i64>(fadeRemainderCarry)
				);
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
			endedMask |= 1u << slot;
		}
	}

	i16* output = m_renderBuffer.data();
	for (size_t index = 0; index < totalSamples; index += 1u) {
		output[index] = static_cast<i16>(clamp<i64>(
			shiftRightSigned(mix[index], APU_GAIN_Q12_FRACTION_BITS),
			-0x8000,
			0x7fff
		));
	}
	outputRing.write(output, frameCount, startSequence);
	return endedMask;
}

void ApuOutputMixer::buildVoiceFromData(
	VoiceRecord& record,
	const ApuAudioSource& source,
	const ApuSourceByteView& sourceBytes,
	u32 rateStepQ16Word,
	i64 cursorQ16,
	i32 phaseRemainder
) {
	const bool usesBadp = !apuAudioSourceUsesGenerator(source) && source.bitsPerSample == 4u;
	if (usesBadp) {
		loadApuBadpSeekTable(record.badpSeekTable, sourceBytes.bytes.data(), 0u);
	} else {
		record.badpSeekTable.bytes = nullptr;
		record.badpSeekTable.byteOffset = 0u;
		record.badpSeekTable.entryCount = 0u;
	}
	record.active = true;
	record.sourceCartridgeSlot = sourceBytes.cartridgeSlot;
	record.channels = source.channels;
	record.bitsPerSample = source.bitsPerSample;
	record.sourceBytes = sourceBytes.bytes.data();
	record.dataOffset = source.dataOffset;
	record.frames = source.frameCount;
	record.generatorKind = source.generatorKind;
	record.generatorDutyQ12 = source.generatorDutyQ12;
	record.cursorQ16 = cursorQ16;
	record.phaseRemainder = phaseRemainder;
	configurePhaseStep(record, rateStepQ16Word, source.sampleRateHz);
	applyVoiceLoopBounds(record, source);
	record.usesBadp = usesBadp;
	if (record.usesBadp) {
		resetApuBadpDecoder(
			record.sourceBytes + record.dataOffset,
			record.frames,
			record.channels,
			record.badpSeekTable,
			record.badp,
			audioFrameIndex(record.cursorQ16)
		);
	}
}

void ApuOutputMixer::configurePhaseStep(VoiceRecord& record, u32 rateStepQ16Word, u32 sampleRateHz) {
	resolveApuPhaseStep(m_phaseStep, rateStepQ16Word, sampleRateHz);
	record.phaseStepQ16 = m_phaseStep.wholeQ16;
	record.phaseStepRemainder = m_phaseStep.remainder;
}

void ApuOutputMixer::applyVoiceGainQ12(VoiceRecord& record, u32 gainQ12Word) {
	record.gainQ12 = toSignedWord(gainQ12Word);
	if (record.fadeSamplesRemaining != 0u) {
		configureFade(record, record.fadeSamplesRemaining);
	}
}

void ApuOutputMixer::configureFade(VoiceRecord& record, u32 fadeSamples) {
	const i64 gainQ12 = record.gainQ12;
	const i64 remainder = gainQ12 % static_cast<i64>(fadeSamples);
	record.fadeStepQ12 = static_cast<i32>((gainQ12 - remainder) / static_cast<i64>(fadeSamples));
	record.fadeStepRemainder = static_cast<i32>(remainder);
	record.fadeError = fadeSamples - 1u;
	record.fadeSamplesRemaining = fadeSamples;
	record.fadeSamplesTotal = fadeSamples;
}

void ApuOutputMixer::applyVoiceLoopBounds(VoiceRecord& record, const ApuAudioSource& source) {
	if (source.loopEndSample > source.loopStartSample) {
		record.loopStartQ16 = static_cast<i64>(source.loopStartSample) * static_cast<i64>(APU_RATE_STEP_Q16_ONE);
		record.loopEndQ16 = static_cast<i64>(source.loopEndSample) * static_cast<i64>(APU_RATE_STEP_Q16_ONE);
		return;
	}
	record.loopStartQ16 = -1;
	record.loopEndQ16 = -1;
}

void ApuOutputMixer::seekVoice(VoiceRecord& record, u32 startFrame) {
	record.cursorQ16 = static_cast<i64>(startFrame) * static_cast<i64>(APU_RATE_STEP_Q16_ONE);
	record.phaseRemainder = 0;
	if (record.usesBadp) {
		resetApuBadpDecoder(
			record.sourceBytes + record.dataOffset,
			record.frames,
			record.channels,
			record.badpSeekTable,
			record.badp,
			startFrame
		);
	}
}

void ApuOutputMixer::readVoiceFrame(VoiceRecord& record, size_t frame) {
	if (record.usesBadp) {
		i16 left = 0;
		i16 right = 0;
		readApuBadpFrameAt(
			record.sourceBytes + record.dataOffset,
			record.frames,
			record.channels,
			record.badpSeekTable,
			record.badp,
			frame,
			left,
			right
		);
		m_sampledLeft = left;
		m_sampledRight = right;
		return;
	}
	const size_t baseSample = frame * record.channels;
	const bool is16Bit = record.bitsPerSample == 16u;
	m_sampledLeft = readApuPcmSample(record.sourceBytes, record.dataOffset, is16Bit, baseSample);
	m_sampledRight = record.channels == 1u
		? m_sampledLeft
		: readApuPcmSample(record.sourceBytes, record.dataOffset, is16Bit, baseSample + 1u);
}

i64 ApuOutputMixer::wrapLoopCursor(i64 cursorQ16, i64 loopStartQ16, i64 loopEndQ16) {
	const i64 lengthQ16 = loopEndQ16 - loopStartQ16;
	i64 wrapped = (cursorQ16 - loopStartQ16) % lengthQ16;
	if (wrapped < 0) {
		wrapped += lengthQ16;
	}
	return loopStartQ16 + wrapped;
}

void ApuOutputMixer::configureRecordFilter(VoiceRecord& record, const ApuParameterRegisterWords& registerWords) {
	configureBiquadFilter(
		record.filter,
		registerWords[APU_PARAMETER_FILTER_CONTROL_INDEX],
		registerWords[APU_PARAMETER_FILTER_B0_B1_INDEX],
		registerWords[APU_PARAMETER_FILTER_B2_A1_INDEX],
		registerWords[APU_PARAMETER_FILTER_A2_INDEX]
	);
}

} // namespace bmsx
