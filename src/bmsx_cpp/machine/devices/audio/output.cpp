/*
 * output.cpp - APU/AOUT sample output and mixing.
 */

#include "machine/devices/audio/output.h"

#include "machine/devices/audio/badp_decoder_hot_path.h"
#include "machine/devices/audio/pcm_decoder_hot_path.h"
#include "machine/devices/audio/source.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <utility>

namespace bmsx {

static constexpr f32 MIN_GAIN = 0.0001f;
static constexpr ApuOutputStartResult APU_OUTPUT_START_OK{};
static inline bool consumeStopTimer(f64& stopAfter, f64 invOutputRate) {
	if (stopAfter < 0.0) {
		return false;
	}
	stopAfter -= invOutputRate;
	return stopAfter <= 0.0;
}

static inline f32 lerpAudioSample(f32 from, f32 to, f64 frac) {
	return from + (to - from) * static_cast<f32>(frac);
}

static inline i64 audioFrameIndex(f64 position) {
	return static_cast<i64>(position);
}

static inline f32 squareGeneratorSample(f64 position, u32 dutyQ12) {
	const f64 phaseQ12 = (position - static_cast<f64>(audioFrameIndex(position))) * static_cast<f64>(APU_GAIN_Q12_ONE);
	return phaseQ12 < static_cast<f64>(dutyQ12) ? 1.0f : -1.0f;
}

static inline bool audioPositionIsInteger(f64 position) {
	return position == static_cast<f64>(audioFrameIndex(position));
}

static inline void audioSamplePosition(f64 position, i64& index, f64& frac, size_t& index0) {
	index = audioFrameIndex(position);
	frac = position - static_cast<f64>(index);
	index0 = static_cast<size_t>(index);
}

static inline i64 wrappedAudioIndex(i64 index, f64 loopStart, f64 loopEnd) {
	if (static_cast<f64>(index) < loopEnd) {
		return index;
	}
	const f64 wrapped = loopStart + (static_cast<f64>(index) - loopEnd);
	return static_cast<i64>(wrapped);
}

static inline void wrapAudioPosition(f64& position, f64 loopStart, f64 loopEnd, f64 loopLen) {
	if (position < loopStart || position >= loopEnd) {
		position = loopStart + std::fmod(position - loopStart, loopLen);
		if (position < loopStart) {
			position += loopLen;
		}
	}
}

static inline void advanceGainRamp(f32& gain, f64& remaining, f64 gainStep, f64 invOutputRate) {
	if (remaining <= 0.0) {
		return;
	}
	gain += static_cast<f32>(gainStep);
	remaining -= invOutputRate;
}

static inline void advanceLinearAudioFrame(f64& position, f64 step, f32& gain, f64& rampRemaining, f64 gainStep, f64 invOutputRate) {
	position += step;
	advanceGainRamp(gain, rampRemaining, gainStep, invOutputRate);
}

static inline void advanceLoopedAudioFrame(f64& position,
											f64 step,
											f64 loopStart,
											f64 loopEnd,
											f64 loopLen,
											f32& gain,
											f64& rampRemaining,
											f64 gainStep,
											f64 invOutputRate) {
	position += step;
	wrapAudioPosition(position, loopStart, loopEnd, loopLen);
	advanceGainRamp(gain, rampRemaining, gainStep, invOutputRate);
}

void ApuOutputMixer::resetPlaybackState() {
	m_voices.clear();
	outputRing.clear();
}

void ApuOutputMixer::pullOutputFrames(i16* output, size_t frameCount, i32 outputSampleRate, f32 outputGain, size_t targetQueuedFrames) {
	if (frameCount > APU_OUTPUT_QUEUE_CAPACITY_FRAMES) {
		throw std::runtime_error("[AOUT] Host pull exceeds the output-ring capacity.");
	}
	fillOutputQueueTo(frameCount, outputSampleRate, outputGain);
	outputRing.read(output, frameCount);
	fillOutputQueueTo(targetQueuedFrames, outputSampleRate, outputGain);
}

ApuOutputStartResult ApuOutputMixer::playVoice(ApuAudioSlot slot, ApuVoiceId voiceId, const ApuAudioSource& source, const std::vector<u8>& sourceBytes, const ApuParameterRegisterWords& registerWords, i64 playbackCursorQ16, u32 stopFadeSamples) {
	const ApuOutputPlayback playback = resolveApuOutputPlayback(registerWords);
	if (playback.playbackRate <= 0.0f) {
		return {APU_FAULT_OUTPUT_PLAYBACK_RATE, registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX]};
	}
	const f32 initialGain = clampVolume(playback.gainLinear);
	std::vector<u32> badpSeekFrames;
	std::vector<u32> badpSeekOffsets;
	if (!apuAudioSourceUsesGenerator(source)) {
		if (source.bitsPerSample == 4) {
			ApuBadpSeekTableResult badpSeek = readApuBadpSeekTable(sourceBytes.data());
			badpSeekFrames = std::move(badpSeek.frames);
			badpSeekOffsets = std::move(badpSeek.offsets);
		}
	}
	VoiceRecord record = buildVoiceFromData(
		slot,
		voiceId,
		source,
		sourceBytes,
		std::move(badpSeekFrames),
		std::move(badpSeekOffsets),
		playback,
		playbackCursorQ16,
		initialGain
	);
	if (stopFadeSamples > 0u) {
		const f64 fadeSec = static_cast<f64>(stopFadeSamples) / static_cast<f64>(APU_SAMPLE_RATE_HZ);
		rampVoiceGain(record, MIN_GAIN, fadeSec);
		record.stopAfter = fadeSec;
	}
	m_voices.push_back(std::move(record));
	return APU_OUTPUT_START_OK;
}

ApuOutputStartResult ApuOutputMixer::writeSlotRegisterWord(ApuAudioSlot slot, const ApuAudioSource& source, const ApuParameterRegisterWords& registerWords, u32 parameterIndex, i64 playbackCursorQ16) {
	f32 playbackRate = 0.0f;
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
			return {APU_FAULT_OUTPUT_METADATA, parameterIndex};
		case APU_PARAMETER_RATE_STEP_Q16_INDEX:
			playbackRate = resolveApuPlaybackRate(registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX]);
			if (playbackRate <= 0.0f) {
				return {APU_FAULT_OUTPUT_PLAYBACK_RATE, registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX]};
			}
			break;
		default:
			break;
	}
	VoiceRecord* record = findSlot(slot);
	if (!record) {
		return APU_OUTPUT_START_OK;
	}
	switch (parameterIndex) {
		case APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX:
		case APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX:
			applyVoiceLoopBounds(*record, source);
			return APU_OUTPUT_START_OK;
		case APU_PARAMETER_RATE_STEP_Q16_INDEX:
			record->playback.playbackRate = playbackRate;
			record->step = playbackRate;
			return APU_OUTPUT_START_OK;
		case APU_PARAMETER_GAIN_Q12_INDEX:
			applyVoiceGainQ12(*record, registerWords[APU_PARAMETER_GAIN_Q12_INDEX]);
			return APU_OUTPUT_START_OK;
		case APU_PARAMETER_GENERATOR_DUTY_Q12_INDEX:
			record->generatorDutyQ12 = source.generatorDutyQ12;
			return APU_OUTPUT_START_OK;
		case APU_PARAMETER_START_SAMPLE_INDEX:
			seekVoice(*record, registerWords[APU_PARAMETER_START_SAMPLE_INDEX], playbackCursorQ16);
			return APU_OUTPUT_START_OK;
		case APU_PARAMETER_FILTER_KIND_INDEX:
		case APU_PARAMETER_FILTER_FREQ_HZ_INDEX:
		case APU_PARAMETER_FILTER_Q_MILLI_INDEX:
		case APU_PARAMETER_FILTER_GAIN_MILLIDB_INDEX:
			record->playback.filter = resolveApuOutputFilter(registerWords);
			record->filterSampleRate = 0;
			return APU_OUTPUT_START_OK;
		default:
			return APU_OUTPUT_START_OK;
	}
}

bool ApuOutputMixer::stopSlot(ApuAudioSlot slot, u32 fadeSamples) {
	const std::optional<size_t> index = findSlotIndex(slot);
	if (!index.has_value()) {
		return false;
	}
	return stopVoiceAtIndex(*index, fadeSamples);
}

std::optional<size_t> ApuOutputMixer::findSlotIndex(ApuAudioSlot slot) const {
	for (size_t index = 0; index < m_voices.size(); ++index) {
		if (m_voices[index].slot == slot) {
			return index;
		}
	}
	return std::nullopt;
}

bool ApuOutputMixer::stopVoiceAtIndex(size_t index, u32 fadeSamples) {
	if (fadeSamples > 0u) {
		const f64 fadeSec = static_cast<f64>(fadeSamples) / static_cast<f64>(APU_SAMPLE_RATE_HZ);
		rampVoiceGain(m_voices[index], MIN_GAIN, fadeSec);
		m_voices[index].stopAfter = fadeSec;
		return true;
	}
	removeVoice(index);
	return true;
}

void ApuOutputMixer::stopAllVoices() {
	while (!m_voices.empty()) {
		removeVoice(m_voices.size() - 1);
	}
}

void ApuOutputMixer::renderSamples(i16* output, size_t frameCount, i32 outputSampleRate, f32 outputGain) {
	const size_t totalSamples = frameCount * 2;
	if (frameCount > APU_OUTPUT_QUEUE_CAPACITY_FRAMES) {
		throw std::runtime_error("[AOUT] Render request exceeds the output-ring capacity.");
	}
	std::fill(m_mixBuffer.begin(), m_mixBuffer.begin() + totalSamples, 0.0f);

	const f64 invOutputRate = 1.0 / static_cast<f64>(outputSampleRate);
	const f32 sampleScale = APU_PCM_SAMPLE_SCALE;
	f32* mix = m_mixBuffer.data();

	for (size_t i = 0; i < m_voices.size();) {
			VoiceRecord& record = m_voices[i];
			const u8* data = record.data;
			const int channels = record.channels;
			const size_t framesInRecord = record.frames;
			if (framesInRecord == 0) {
				removeVoice(i);
				continue;
			}
			const bool is16Bit = record.bitsPerSample == 16;

				const bool hasLoopStart = record.loopStartFrame.has_value();
				const f64 loopStart = hasLoopStart ? *record.loopStartFrame : 0.0;
				const f64 loopEnd = record.loopEndFrame.has_value() ? *record.loopEndFrame : static_cast<f64>(framesInRecord);
				const bool hasLoop = hasLoopStart && loopEnd > loopStart;
				const f64 loopLen = loopEnd - loopStart;
				const f64 framesInRecordF = static_cast<f64>(framesInRecord);

			const f64 step = record.step * (static_cast<f64>(record.sampleRate) * invOutputRate);

			f64 position = record.position;
			f32 gain = record.gain;
			f64 rampRemaining = record.gainRampRemaining;
			f64 stopAfter = record.stopAfter;
			f64 gainStep = 0.0;
			if (rampRemaining > 0.0) {
				const f64 rampFrames = rampRemaining * static_cast<f64>(outputSampleRate);
				gainStep = (record.targetGain - gain) / rampFrames;
			}
			if (record.playback.filter.has_value()) {
				if (record.filterSampleRate != outputSampleRate) {
					const auto& filter = record.playback.filter.value();
					configureBiquadFilter(
						record.filter,
						filter.type,
						filter.frequency,
						filter.q,
						filter.gain,
						static_cast<f32>(outputSampleRate)
					);
					record.filterSampleRate = outputSampleRate;
				}
			} else {
				record.filter.reset();
				record.filterSampleRate = 0;
			}

				bool ended = false;
				if (record.generatorKind == APU_GENERATOR_SQUARE) {
					size_t outIndex = 0;
					for (size_t frame = 0; frame < frameCount; ++frame) {
						if (consumeStopTimer(stopAfter, invOutputRate)) {
							ended = true;
							break;
						}
						if (hasLoop) {
							wrapAudioPosition(position, loopStart, loopEnd, loopLen);
						} else if (position >= framesInRecordF) {
							ended = true;
							break;
						}

						const f32 sample = squareGeneratorSample(position, record.generatorDutyQ12);
						mixVoiceSample(record, mix, outIndex, sample, sample, gain);

						if (hasLoop) {
							advanceLoopedAudioFrame(position, step, loopStart, loopEnd, loopLen, gain, rampRemaining, gainStep, invOutputRate);
						} else {
							advanceLinearAudioFrame(position, step, gain, rampRemaining, gainStep, invOutputRate);
						}
					}
				} else if (record.usesBadp) {
					const u32 badpChannels = static_cast<u32>(record.channels);
					size_t outIndex = 0;
					for (size_t frame = 0; frame < frameCount; ++frame) {
						if (consumeStopTimer(stopAfter, invOutputRate)) {
							ended = true;
							break;
						}
					if (hasLoop) {
						wrapAudioPosition(position, loopStart, loopEnd, loopLen);
					} else if (position >= framesInRecordF) {
						ended = true;
						break;
					}

						i64 idx = 0;
						f64 frac = 0.0;
						size_t idx0 = 0;
						audioSamplePosition(position, idx, frac, idx0);
						i64 idx1 = idx + 1;
						if (hasLoop) {
							idx1 = wrappedAudioIndex(idx1, loopStart, loopEnd);
						} else if (static_cast<size_t>(idx1) >= framesInRecord) {
							idx1 = idx;
						}
						const size_t nextIndex = static_cast<size_t>(idx1);

					i16 left0i = 0;
					i16 right0i = 0;
					if (!readApuBadpFrameAt(record.data, record.frames, badpChannels, record.badpSeekFrames, record.badpSeekOffsets, record.badp, idx0, left0i, right0i)) {
						ended = true;
						break;
					}
					i16 left1i = left0i;
					i16 right1i = right0i;
						if (nextIndex != idx0 && !readApuBadpFrameAt(record.data, record.frames, badpChannels, record.badpSeekFrames, record.badpSeekOffsets, record.badp, nextIndex, left1i, right1i)) {
							ended = true;
							break;
						}

					const f32 left0 = static_cast<f32>(left0i) * sampleScale;
					const f32 right0 = static_cast<f32>(right0i) * sampleScale;
					const f32 left1 = static_cast<f32>(left1i) * sampleScale;
					const f32 right1 = static_cast<f32>(right1i) * sampleScale;
							mixVoiceSample(record, mix, outIndex, lerpAudioSample(left0, left1, frac), lerpAudioSample(right0, right1, frac), gain);

						if (hasLoop) {
							advanceLoopedAudioFrame(position, step, loopStart, loopEnd, loopLen, gain, rampRemaining, gainStep, invOutputRate);
						} else {
							advanceLinearAudioFrame(position, step, gain, rampRemaining, gainStep, invOutputRate);
						}
					}
			} else {
				const bool fastPath = step == 1.0 && audioPositionIsInteger(position);

				if (fastPath) {
					size_t posIndex = static_cast<size_t>(position);
					if (hasLoop) {
						wrapAudioPosition(position, loopStart, loopEnd, loopLen);
						posIndex = static_cast<size_t>(position);
					}
					const size_t loopStartIndex = static_cast<size_t>(loopStart);
					const size_t loopEndIndex = static_cast<size_t>(loopEnd);
				size_t outIndex = 0;

				if (channels == 1) {
					for (size_t frame = 0; frame < frameCount; ++frame) {
						if (stopAfter >= 0.0) {
							stopAfter -= invOutputRate;
							if (stopAfter <= 0.0) {
								ended = true;
								break;
							}
						}
						if (!hasLoop && posIndex >= framesInRecord) {
							ended = true;
							break;
						}

						const f32 sample = static_cast<f32>(readApuPcmSample(data, 0u, is16Bit, posIndex)) * sampleScale;
						mixVoiceSample(record, mix, outIndex, sample, sample, gain);

						++posIndex;
						if (hasLoop && posIndex >= loopEndIndex) {
							posIndex = loopStartIndex;
						}

						if (rampRemaining > 0.0) {
							gain += static_cast<f32>(gainStep);
							rampRemaining -= invOutputRate;
						}
					}
				} else {
					for (size_t frame = 0; frame < frameCount; ++frame) {
						if (stopAfter >= 0.0) {
							stopAfter -= invOutputRate;
							if (stopAfter <= 0.0) {
								ended = true;
								break;
							}
						}
						if (!hasLoop && posIndex >= framesInRecord) {
							ended = true;
							break;
						}

						const size_t base = posIndex * static_cast<size_t>(channels);
						const f32 left = static_cast<f32>(readApuPcmSample(data, 0u, is16Bit, base)) * sampleScale;
						const f32 right = static_cast<f32>(readApuPcmSample(data, 0u, is16Bit, base + 1)) * sampleScale;
						mixVoiceSample(record, mix, outIndex, left, right, gain);

						++posIndex;
						if (hasLoop && posIndex >= loopEndIndex) {
							posIndex = loopStartIndex;
						}

						if (rampRemaining > 0.0) {
							gain += static_cast<f32>(gainStep);
							rampRemaining -= invOutputRate;
						}
					}
				}

				position = static_cast<f64>(posIndex);
			} else {
				size_t outIndex = 0;

				if (channels == 1) {
					if (hasLoop) {
							for (size_t frame = 0; frame < frameCount; ++frame) {
								if (consumeStopTimer(stopAfter, invOutputRate)) {
									ended = true;
									break;
								}
								wrapAudioPosition(position, loopStart, loopEnd, loopLen);

								i64 idx = 0;
								f64 frac = 0.0;
								size_t idx0 = 0;
								audioSamplePosition(position, idx, frac, idx0);
								const i64 idx1 = wrappedAudioIndex(idx + 1, loopStart, loopEnd);

								const f32 s0 = static_cast<f32>(readApuPcmSample(data, 0u, is16Bit, idx0)) * sampleScale;
								const f32 s1 = static_cast<f32>(readApuPcmSample(data, 0u, is16Bit, static_cast<size_t>(idx1))) * sampleScale;
								const f32 sample = lerpAudioSample(s0, s1, frac);
								mixVoiceSample(record, mix, outIndex, sample, sample, gain);

									advanceLoopedAudioFrame(position, step, loopStart, loopEnd, loopLen, gain, rampRemaining, gainStep, invOutputRate);
							}
						} else {
							for (size_t frame = 0; frame < frameCount; ++frame) {
								if (consumeStopTimer(stopAfter, invOutputRate)) {
									ended = true;
									break;
								}
							if (position >= framesInRecordF) {
								ended = true;
								break;
							}

							i64 idx = 0;
							f64 frac = 0.0;
							size_t idx0 = 0;
							audioSamplePosition(position, idx, frac, idx0);
							const f32 s0 = static_cast<f32>(readApuPcmSample(data, 0u, is16Bit, idx0)) * sampleScale;
							f32 s1 = 0.0f;
							const size_t idx1 = idx0 + 1;
							if (idx1 < framesInRecord) {
								s1 = static_cast<f32>(readApuPcmSample(data, 0u, is16Bit, idx1)) * sampleScale;
							}
								const f32 sample = lerpAudioSample(s0, s1, frac);
								mixVoiceSample(record, mix, outIndex, sample, sample, gain);

									advanceLinearAudioFrame(position, step, gain, rampRemaining, gainStep, invOutputRate);
							}
						}
				} else {
						if (hasLoop) {
							for (size_t frame = 0; frame < frameCount; ++frame) {
								if (consumeStopTimer(stopAfter, invOutputRate)) {
									ended = true;
									break;
								}
								wrapAudioPosition(position, loopStart, loopEnd, loopLen);

								i64 idx = 0;
								f64 frac = 0.0;
								size_t idx0 = 0;
								audioSamplePosition(position, idx, frac, idx0);
								const i64 idx1 = wrappedAudioIndex(idx + 1, loopStart, loopEnd);

							const size_t base0 = idx0 * static_cast<size_t>(channels);
							const size_t base1 = static_cast<size_t>(idx1) * static_cast<size_t>(channels);
							const f32 left0 = static_cast<f32>(readApuPcmSample(data, 0u, is16Bit, base0)) * sampleScale;
							const f32 right0 = static_cast<f32>(readApuPcmSample(data, 0u, is16Bit, base0 + 1)) * sampleScale;
							const f32 left1 = static_cast<f32>(readApuPcmSample(data, 0u, is16Bit, base1)) * sampleScale;
							const f32 right1 = static_cast<f32>(readApuPcmSample(data, 0u, is16Bit, base1 + 1)) * sampleScale;

									mixVoiceSample(record, mix, outIndex, lerpAudioSample(left0, left1, frac), lerpAudioSample(right0, right1, frac), gain);

									advanceLoopedAudioFrame(position, step, loopStart, loopEnd, loopLen, gain, rampRemaining, gainStep, invOutputRate);
							}
						} else {
							for (size_t frame = 0; frame < frameCount; ++frame) {
								if (consumeStopTimer(stopAfter, invOutputRate)) {
									ended = true;
									break;
								}
							if (position >= framesInRecordF) {
								ended = true;
								break;
							}

							i64 idx = 0;
							f64 frac = 0.0;
							size_t idx0 = 0;
							audioSamplePosition(position, idx, frac, idx0);
							const size_t base0 = idx0 * static_cast<size_t>(channels);
							const f32 left0 = static_cast<f32>(readApuPcmSample(data, 0u, is16Bit, base0)) * sampleScale;
							const f32 right0 = static_cast<f32>(readApuPcmSample(data, 0u, is16Bit, base0 + 1)) * sampleScale;
							f32 left1 = 0.0f;
							f32 right1 = 0.0f;
							const size_t idx1 = idx0 + 1;
							if (idx1 < framesInRecord) {
								const size_t base1 = idx1 * static_cast<size_t>(channels);
								left1 = static_cast<f32>(readApuPcmSample(data, 0u, is16Bit, base1)) * sampleScale;
								right1 = static_cast<f32>(readApuPcmSample(data, 0u, is16Bit, base1 + 1)) * sampleScale;
							}

									mixVoiceSample(record, mix, outIndex, lerpAudioSample(left0, left1, frac), lerpAudioSample(right0, right1, frac), gain);

									advanceLinearAudioFrame(position, step, gain, rampRemaining, gainStep, invOutputRate);
							}
						}
				}
			}
			}

			record.position = position;
			record.gain = gain;
			record.gainRampRemaining = rampRemaining > 0.0 ? rampRemaining : 0.0;
			if (record.gainRampRemaining == 0.0f) {
				record.gain = record.targetGain;
			}
			record.stopAfter = stopAfter;

			if (ended) {
				removeVoice(i);
				continue;
			}
			++i;
	}

	for (size_t i = 0; i < totalSamples; ++i) {
		f32 v = mix[i] * outputGain;
		if (v > 1.0f) v = 1.0f;
		if (v < -1.0f) v = -1.0f;
		output[i] = static_cast<i16>(std::lrint(v * 32767.0f));
	}
}

void ApuOutputMixer::fillOutputQueueTo(size_t targetFrames, i32 outputSampleRate, f32 outputGain) {
	if (targetFrames > APU_OUTPUT_QUEUE_CAPACITY_FRAMES) {
		targetFrames = APU_OUTPUT_QUEUE_CAPACITY_FRAMES;
	}
	if (outputRing.queuedFrames() >= targetFrames) {
		return;
	}
	const size_t framesToRender = targetFrames - outputRing.queuedFrames();
	renderSamples(outputRing.renderBuffer(), framesToRender, outputSampleRate, outputGain);
	outputRing.write(outputRing.renderBuffer(), framesToRender);
}

ApuOutputMixer::VoiceRecord ApuOutputMixer::buildVoiceFromData(ApuAudioSlot slot,
														 ApuVoiceId voiceId,
														 const ApuAudioSource& source,
														 const std::vector<u8>& sourceBytes,
														 std::vector<u32> badpSeekFrames,
														 std::vector<u32> badpSeekOffsets,
														 const ApuOutputPlayback& playback,
														 i64 playbackCursorQ16,
														 f32 initialGain) {
	VoiceRecord record;
	record.voiceId = voiceId;
	record.sampleRate = static_cast<i32>(source.sampleRateHz);
	record.channels = static_cast<i32>(source.channels);
	record.bitsPerSample = static_cast<i32>(source.bitsPerSample);
	record.dataSize = source.dataBytes;
	record.frames = source.frameCount;
	record.generatorKind = source.generatorKind;
	record.generatorDutyQ12 = source.generatorDutyQ12;
	record.badpSeekFrames = std::move(badpSeekFrames);
	record.badpSeekOffsets = std::move(badpSeekOffsets);
	if (source.loopEndSample > source.loopStartSample) {
		record.loopStartFrame = static_cast<f64>(source.loopStartSample);
		record.loopEndFrame = static_cast<f64>(source.loopEndSample);
	}
	record.slot = slot;
	record.playback = playback;
	record.data = apuAudioSourceUsesGenerator(source) ? sourceBytes.data() : sourceBytes.data() + source.dataOffset;
	record.usesBadp = !apuAudioSourceUsesGenerator(source) && source.bitsPerSample == 4;
	const size_t framesInRecord = record.frames;
	f64 position = static_cast<f64>(playbackCursorQ16) / static_cast<f64>(APU_RATE_STEP_Q16_ONE);
	if (framesInRecord > 0u) {
		if (record.loopStartFrame.has_value()) {
			position = std::fmod(position, static_cast<f64>(framesInRecord));
			if (position < 0.0) position += static_cast<f64>(framesInRecord);
		} else {
			if (position < 0.0) position = 0.0;
			if (position > static_cast<f64>(framesInRecord)) position = static_cast<f64>(framesInRecord);
		}
	}
	record.position = position;
	record.step = playback.playbackRate;
	record.gain = initialGain;
	record.targetGain = initialGain;
	record.gainRampRemaining = 0.0;
	record.stopAfter = -1.0;
	if (record.usesBadp) {
		resetApuBadpDecoder(record.data, record.frames, static_cast<u32>(record.channels), record.badpSeekFrames, record.badpSeekOffsets, record.badp, static_cast<size_t>(audioFrameIndex(record.position)));
	}

	return record;
}

void ApuOutputMixer::removeVoice(size_t index) {
	const size_t last = m_voices.size() - 1u;
	if (index != last) {
		m_voices[index] = std::move(m_voices[last]);
	}
	m_voices.pop_back();
}

ApuOutputMixer::VoiceRecord* ApuOutputMixer::findSlot(ApuAudioSlot slot) {
	for (auto& record : m_voices) {
		if (record.slot == slot) {
			return &record;
		}
	}
	return nullptr;
}

const ApuOutputMixer::VoiceRecord* ApuOutputMixer::findSlot(ApuAudioSlot slot) const {
	for (const auto& record : m_voices) {
		if (record.slot == slot) {
			return &record;
		}
	}
	return nullptr;
}


void ApuOutputMixer::rampVoiceGain(VoiceRecord& record, f32 target, f64 durationSec) {
	record.targetGain = target;
	record.gainRampRemaining = durationSec;
}

void ApuOutputMixer::applyVoiceGainQ12(VoiceRecord& record, u32 gainQ12Word) {
	const f32 gainLinear = resolveApuGainLinear(gainQ12Word);
	const f32 clamped = clampVolume(gainLinear);
	record.playback.gainLinear = gainLinear;
	record.gain = clamped;
	record.targetGain = clamped;
	record.gainRampRemaining = 0.0;
}

void ApuOutputMixer::applyVoiceLoopBounds(VoiceRecord& record, const ApuAudioSource& source) {
	if (source.loopEndSample > source.loopStartSample) {
		record.loopStartFrame = static_cast<f64>(source.loopStartSample);
		record.loopEndFrame = static_cast<f64>(source.loopEndSample);
	} else {
		record.loopStartFrame.reset();
		record.loopEndFrame.reset();
	}
}

void ApuOutputMixer::mixVoiceSample(VoiceRecord& record, f32* mix, size_t& outIndex, f32 left, f32 right, f32 gain) {
	if (record.filter.enabled) {
		record.filter.processStereo(left, right);
	}
	mix[outIndex] += left * gain;
	mix[outIndex + 1] += right * gain;
	outIndex += 2u;
}

void ApuOutputMixer::seekVoice(VoiceRecord& record, u32 startFrame, i64 playbackCursorQ16) {
	record.position = static_cast<f64>(playbackCursorQ16) / static_cast<f64>(APU_RATE_STEP_Q16_ONE);
	if (record.usesBadp && startFrame <= record.frames) {
		resetApuBadpDecoder(record.data, record.frames, static_cast<u32>(record.channels), record.badpSeekFrames, record.badpSeekOffsets, record.badp, startFrame);
	}
}

f32 ApuOutputMixer::clampVolume(f32 value) const {
	if (value < 0.0f) return 0.0f;
	if (value > 1.0f) return 1.0f;
	return value;
}

} // namespace bmsx
