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
#include <utility>

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
	const Span<const u8>& sourceBytes,
	const ApuParameterRegisterWords& registerWords
) {
	const ApuOutputPlayback playback = resolveApuOutputPlayback(registerWords);
	buildVoiceFromData(
		m_voices[slot],
		source,
		sourceBytes,
		playback,
		registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX],
		static_cast<i64>(registerWords[APU_PARAMETER_START_SAMPLE_INDEX]) * static_cast<i64>(APU_RATE_STEP_Q16_ONE),
		0,
		clamp(playback.gainLinear, 0.0, 1.0)
	);
}

void ApuOutputMixer::replaceVoiceSource(
	ApuAudioSlot slot,
	const ApuAudioSource& source,
	const Span<const u8>& sourceBytes,
	const ApuParameterRegisterWords& registerWords
) {
	VoiceRecord& record = m_voices[slot];
	const i64 cursorQ16 = record.cursorQ16;
	const i32 phaseRemainder = record.phaseRemainder;
	const f64 gain = record.gain;
	const f64 fadeStartGain = record.fadeStartGain;
	const u32 fadeSamplesRemaining = record.fadeSamplesRemaining;
	const u32 fadeSamplesTotal = record.fadeSamplesTotal;
	const ApuOutputPlayback playback = resolveApuOutputPlayback(registerWords);
	buildVoiceFromData(
		record,
		source,
		sourceBytes,
		playback,
		registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX],
		cursorQ16,
		phaseRemainder,
		gain
	);
	record.fadeStartGain = fadeStartGain;
	record.fadeSamplesRemaining = fadeSamplesRemaining;
	record.fadeSamplesTotal = fadeSamplesTotal;
}

void ApuOutputMixer::restoreVoice(
	ApuAudioSlot slot,
	const ApuAudioSource& source,
	const Span<const u8>& sourceBytes,
	const ApuParameterRegisterWords& registerWords,
	const ApuOutputVoiceState& state
) {
	const ApuOutputPlayback playback = resolveApuOutputPlayback(registerWords);
	VoiceRecord& record = m_voices[slot];
	buildVoiceFromData(
		record,
		source,
		sourceBytes,
		playback,
		registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX],
		state.cursorQ16,
		state.phaseRemainder,
		state.gain
	);
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
		case APU_PARAMETER_FILTER_KIND_INDEX:
		case APU_PARAMETER_FILTER_FREQ_HZ_INDEX:
		case APU_PARAMETER_FILTER_Q_MILLI_INDEX:
		case APU_PARAMETER_FILTER_GAIN_MILLIDB_INDEX:
			applyApuOutputFilter(record.playback, registerWords);
			configureRecordFilter(record);
			return;
		default:
			return;
	}
}

void ApuOutputMixer::stopSlot(ApuAudioSlot slot, u32 fadeSamples) {
	VoiceRecord& record = m_voices[slot];
	if (fadeSamples != 0u && record.active) {
		record.fadeStartGain = record.gain;
		record.fadeSamplesRemaining = fadeSamples;
		record.fadeSamplesTotal = fadeSamples;
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

u32 ApuOutputMixer::renderMachineFrames(i64 frameCount) {
	u32 endedMask = 0u;
	i64 remaining = frameCount;
	while (remaining != 0) {
		const size_t batchFrames = static_cast<size_t>(std::min<i64>(remaining, APU_OUTPUT_RING_CAPACITY_FRAMES));
		endedMask |= renderMachineBatch(batchFrames);
		remaining -= static_cast<i64>(batchFrames);
	}
	return endedMask;
}

u32 ApuOutputMixer::renderMachineBatch(size_t frameCount) {
	const size_t totalSamples = frameCount * 2u;
	std::fill_n(m_mixBuffer.data(), totalSamples, 0.0F);
	u32 endedMask = 0u;
	f32* mix = m_mixBuffer.data();

	for (ApuAudioSlot slot = 0; slot < APU_SLOT_COUNT; slot += 1u) {
		VoiceRecord& record = m_voices[slot];
		if (!record.active) {
			continue;
		}
		const i64 framesInRecordQ16 = static_cast<i64>(record.frames) * static_cast<i64>(APU_RATE_STEP_Q16_ONE);
		const bool hasLoop = record.loopEndQ16 > record.loopStartQ16;
		i64 cursorQ16 = record.cursorQ16;
		i32 phaseRemainder = record.phaseRemainder;
		f64 gain = record.gain;
		u32 fadeRemaining = record.fadeSamplesRemaining;
		bool ended = false;

		for (size_t frame = 0; frame < frameCount; frame += 1u) {
			if (hasLoop) {
				cursorQ16 = wrapLoopCursor(cursorQ16, record.loopStartQ16, record.loopEndQ16);
			} else if (cursorQ16 < 0 || cursorQ16 >= framesInRecordQ16) {
				ended = true;
				break;
			}

			if (fadeRemaining != 0u) {
				gain = record.fadeStartGain * static_cast<f64>(fadeRemaining) / static_cast<f64>(record.fadeSamplesTotal);
			}
			f64 left = 0.0;
			f64 right = 0.0;
			if (record.generatorKind == APU_GENERATOR_SQUARE) {
				const i64 fractionQ16 = cursorQ16 % static_cast<i64>(APU_RATE_STEP_Q16_ONE);
				const f64 sample = fractionQ16 * static_cast<i64>(APU_GAIN_Q12_ONE)
					< static_cast<i64>(record.generatorDutyQ12) * static_cast<i64>(APU_RATE_STEP_Q16_ONE)
					? 1.0
					: -1.0;
				left = sample;
				right = sample;
			} else {
				const i64 frameIndex = audioFrameIndex(cursorQ16);
				const f64 fraction = static_cast<f64>(cursorQ16 % static_cast<i64>(APU_RATE_STEP_Q16_ONE))
					/ static_cast<f64>(APU_RATE_STEP_Q16_ONE);
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
				const f64 left0 = m_sampledLeft;
				const f64 right0 = m_sampledRight;
				left = left0;
				right = right0;
				if (nextFrame != frameIndex) {
					readVoiceFrame(record, static_cast<size_t>(nextFrame));
					left = left0 + (m_sampledLeft - left0) * fraction;
					right = right0 + (m_sampledRight - right0) * fraction;
				}
			}
			if (record.filter.enabled) {
				record.filter.processStereo(left, right);
			}
			const size_t outIndex = frame * 2u;
			mix[outIndex] = static_cast<f32>(static_cast<f64>(mix[outIndex]) + left * gain);
			mix[outIndex + 1u] = static_cast<f32>(static_cast<f64>(mix[outIndex + 1u]) + right * gain);

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
			endedMask |= 1u << slot;
		}
	}

	i16* output = outputRing.renderBuffer();
	for (size_t index = 0; index < totalSamples; index += 1u) {
		output[index] = static_cast<i16>(saturateRoundedI32(static_cast<f64>(clamp(mix[index], -1.0F, 1.0F)) * 32767.0));
	}
	outputRing.write(output, frameCount);
	return endedMask;
}

void ApuOutputMixer::buildVoiceFromData(
	VoiceRecord& record,
	const ApuAudioSource& source,
	const Span<const u8>& sourceBytes,
	const ApuOutputPlayback& playback,
	u32 rateStepQ16Word,
	i64 cursorQ16,
	i32 phaseRemainder,
	f64 initialGain
) {
	std::vector<u32> badpSeekFrames;
	std::vector<u32> badpSeekOffsets;
	if (!apuAudioSourceUsesGenerator(source) && source.bitsPerSample == 4u) {
		ApuBadpSeekTableResult seek = readApuBadpSeekTable(sourceBytes.data(), 0u);
		badpSeekFrames = std::move(seek.frames);
		badpSeekOffsets = std::move(seek.offsets);
	}
	record.active = true;
	record.channels = source.channels;
	record.bitsPerSample = source.bitsPerSample;
	record.sourceBytes = sourceBytes.data();
	record.dataOffset = source.dataOffset;
	record.frames = source.frameCount;
	record.generatorKind = source.generatorKind;
	record.generatorDutyQ12 = source.generatorDutyQ12;
	record.badpSeekFrames = std::move(badpSeekFrames);
	record.badpSeekOffsets = std::move(badpSeekOffsets);
	record.playback = playback;
	record.cursorQ16 = cursorQ16;
	record.phaseRemainder = phaseRemainder;
	configurePhaseStep(record, rateStepQ16Word, source.sampleRateHz);
	record.gain = initialGain;
	record.fadeStartGain = initialGain;
	record.fadeSamplesRemaining = 0u;
	record.fadeSamplesTotal = 0u;
	record.filter.reset();
	applyVoiceLoopBounds(record, source);
	configureRecordFilter(record);
	record.usesBadp = !apuAudioSourceUsesGenerator(source) && source.bitsPerSample == 4u;
	if (record.usesBadp) {
		resetApuBadpDecoder(
			record.sourceBytes + record.dataOffset,
			record.frames,
			record.channels,
			record.badpSeekFrames,
			record.badpSeekOffsets,
			record.badp,
			audioFrameIndex(record.cursorQ16)
		);
	}
}

void ApuOutputMixer::configurePhaseStep(VoiceRecord& record, u32 rateStepQ16Word, u32 sampleRateHz) {
	ApuPhaseStep phaseStep;
	resolveApuPhaseStep(phaseStep, rateStepQ16Word, sampleRateHz);
	record.phaseStepQ16 = phaseStep.wholeQ16;
	record.phaseStepRemainder = phaseStep.remainder;
}

void ApuOutputMixer::applyVoiceGainQ12(VoiceRecord& record, u32 gainQ12Word) {
	const f64 gain = clamp(resolveApuGainLinear(gainQ12Word), 0.0, 1.0);
	record.playback.gainLinear = gain;
	if (record.fadeSamplesRemaining != 0u) {
		record.fadeStartGain = gain;
		record.gain = gain * static_cast<f64>(record.fadeSamplesRemaining) / static_cast<f64>(record.fadeSamplesTotal);
		return;
	}
	record.gain = gain;
	record.fadeStartGain = gain;
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
			record.badpSeekFrames,
			record.badpSeekOffsets,
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
			record.badpSeekFrames,
			record.badpSeekOffsets,
			record.badp,
			frame,
			left,
			right
		);
		m_sampledLeft = static_cast<f64>(left) * static_cast<f64>(APU_PCM_SAMPLE_SCALE);
		m_sampledRight = static_cast<f64>(right) * static_cast<f64>(APU_PCM_SAMPLE_SCALE);
		return;
	}
	const size_t baseSample = frame * record.channels;
	const bool is16Bit = record.bitsPerSample == 16u;
	m_sampledLeft = static_cast<f64>(readApuPcmSample(record.sourceBytes, record.dataOffset, is16Bit, baseSample))
		* static_cast<f64>(APU_PCM_SAMPLE_SCALE);
	m_sampledRight = record.channels == 1u
		? m_sampledLeft
		: static_cast<f64>(readApuPcmSample(record.sourceBytes, record.dataOffset, is16Bit, baseSample + 1u))
			* static_cast<f64>(APU_PCM_SAMPLE_SCALE);
}

i64 ApuOutputMixer::wrapLoopCursor(i64 cursorQ16, i64 loopStartQ16, i64 loopEndQ16) {
	const i64 lengthQ16 = loopEndQ16 - loopStartQ16;
	i64 wrapped = (cursorQ16 - loopStartQ16) % lengthQ16;
	if (wrapped < 0) {
		wrapped += lengthQ16;
	}
	return loopStartQ16 + wrapped;
}

void ApuOutputMixer::configureRecordFilter(VoiceRecord& record) {
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
		APU_SAMPLE_RATE_HZ
	);
}

} // namespace bmsx
