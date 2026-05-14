/*
 * output.cpp - APU/AOUT sample output and mixing.
 */

#include "machine/devices/audio/output.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <utility>

namespace bmsx {

static constexpr f32 MIN_GAIN = 0.0001f;
static constexpr i32 BADP_STEP_TABLE[89] = {
	7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
	19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
	50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
	130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
	337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
	876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
	2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
	5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
	15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
};
static constexpr i32 BADP_INDEX_TABLE[16] = {
	-1, -1, -1, -1, 2, 4, 6, 8,
	-1, -1, -1, -1, 2, 4, 6, 8,
};

static inline u16 readLE16Audio(const u8* data) {
	return static_cast<u16>(data[0]) | (static_cast<u16>(data[1]) << 8);
}

static inline u32 readLE32Audio(const u8* data) {
	return static_cast<u32>(data[0])
		| (static_cast<u32>(data[1]) << 8)
		| (static_cast<u32>(data[2]) << 16)
		| (static_cast<u32>(data[3]) << 24);
}

static constexpr size_t BADP_HEADER_SIZE = 48;
static constexpr u16 BADP_VERSION = 1;
static constexpr u8 BADP_MAGIC[4] = {0x42, 0x41, 0x44, 0x50};
static constexpr ApuOutputStartResult APU_OUTPUT_START_OK{};

struct BadpSeekTableResult {
	ApuOutputStartResult startResult;
	std::vector<u32> frames;
	std::vector<u32> offsets;
};

static bool isBadpSource(const u8* data, size_t size) {
	return size >= BADP_HEADER_SIZE
		&& data[0] == BADP_MAGIC[0]
		&& data[1] == BADP_MAGIC[1]
		&& data[2] == BADP_MAGIC[2]
		&& data[3] == BADP_MAGIC[3];
}

static ApuOutputStartResult validatePcmSourceData(const ApuAudioSource& source) {
	const u64 bytesPerSample = source.bitsPerSample == 16u ? 2u : 1u;
	const u64 requiredDataBytes = static_cast<u64>(source.frameCount) * static_cast<u64>(source.channels) * bytesPerSample;
	if (requiredDataBytes > static_cast<u64>(source.dataBytes)) {
		return {APU_FAULT_OUTPUT_DATA_RANGE, source.dataBytes};
	}
	return APU_OUTPUT_START_OK;
}

static ApuOutputStartResult validateBadpBlocks(const u8* data, const ApuAudioSource& source, const std::vector<u32>& seekFrames, const std::vector<u32>& seekOffsets) {
	size_t offset = 0;
	u32 decodedFrames = 0;
	size_t seekIndex = 0;
	while (decodedFrames < source.frameCount) {
		while (seekIndex < seekOffsets.size() && seekOffsets[seekIndex] == offset) {
			if (seekFrames[seekIndex] != decodedFrames) {
				return {APU_FAULT_OUTPUT_METADATA, static_cast<u32>(seekIndex)};
			}
			seekIndex += 1u;
		}
		if (seekIndex < seekOffsets.size() && seekOffsets[seekIndex] < offset) {
			return {APU_FAULT_OUTPUT_METADATA, static_cast<u32>(seekIndex)};
		}
		const size_t blockOffset = static_cast<size_t>(source.dataOffset) + offset;
		if (offset + 4u > static_cast<size_t>(source.dataBytes)) {
			return {APU_FAULT_OUTPUT_BLOCK, static_cast<u32>(offset)};
		}
		const size_t blockFrames = static_cast<size_t>(readLE16Audio(data + blockOffset));
		const size_t blockBytes = static_cast<size_t>(readLE16Audio(data + blockOffset + 2u));
		if (blockFrames == 0u) {
			return {APU_FAULT_OUTPUT_BLOCK, static_cast<u32>(offset)};
		}
		const size_t blockHeaderBytes = 4u + static_cast<size_t>(source.channels) * 4u;
		if (blockBytes < blockHeaderBytes) {
			return {APU_FAULT_OUTPUT_BLOCK, static_cast<u32>(offset)};
		}
		const size_t blockEnd = offset + blockBytes;
		if (blockEnd > static_cast<size_t>(source.dataBytes)) {
			return {APU_FAULT_OUTPUT_BLOCK, static_cast<u32>(offset)};
		}
		size_t channelCursor = blockOffset + 4u;
		for (u32 channel = 0; channel < source.channels; channel += 1u) {
			if (data[channelCursor + 2u] > 88u) {
				return {APU_FAULT_OUTPUT_BLOCK, static_cast<u32>(offset)};
			}
			channelCursor += 4u;
		}
		if (blockFrames * static_cast<size_t>(source.channels) > (blockBytes - blockHeaderBytes) * 2u) {
			return {APU_FAULT_OUTPUT_BLOCK, static_cast<u32>(offset)};
		}
		decodedFrames += static_cast<u32>(blockFrames);
		offset = blockEnd;
	}
	while (seekIndex < seekOffsets.size()) {
		if (seekFrames[seekIndex] <= source.frameCount) {
			return {APU_FAULT_OUTPUT_METADATA, static_cast<u32>(seekIndex)};
		}
		seekIndex += 1u;
	}
	return APU_OUTPUT_START_OK;
}

static BadpSeekTableResult readBadpSeekTable(const u8* data, size_t size, const ApuAudioSource& source) {
	BadpSeekTableResult result{};
	if (!isBadpSource(data, size)) {
		result.startResult = {APU_FAULT_UNSUPPORTED_FORMAT, static_cast<u32>(size)};
		return result;
	}
	const u16 version = readLE16Audio(data + 4);
	if (version != BADP_VERSION) {
		result.startResult = {APU_FAULT_UNSUPPORTED_FORMAT, version};
		return result;
	}
	const u32 channels = readLE16Audio(data + 6);
	const u32 sampleRate = readLE32Audio(data + 8);
	const u32 frames = readLE32Audio(data + 12);
	const u32 seekEntryCount = readLE32Audio(data + 28);
	const u32 seekTableOffset = readLE32Audio(data + 32);
	const u32 dataOffset = readLE32Audio(data + 36);
	if (channels != source.channels || sampleRate != source.sampleRateHz || frames != source.frameCount || dataOffset != source.dataOffset) {
		result.startResult = {APU_FAULT_OUTPUT_METADATA, dataOffset};
		return result;
	}
	if (dataOffset < BADP_HEADER_SIZE || dataOffset > size) {
		result.startResult = {APU_FAULT_OUTPUT_DATA_RANGE, dataOffset};
		return result;
	}
	if (source.dataBytes == 0 || dataOffset + source.dataBytes > size) {
		result.startResult = {APU_FAULT_OUTPUT_DATA_RANGE, source.dataBytes};
		return result;
	}
	if (seekEntryCount > 0 && (seekTableOffset < BADP_HEADER_SIZE || seekTableOffset >= dataOffset)) {
		result.startResult = {APU_FAULT_OUTPUT_METADATA, seekTableOffset};
		return result;
	}
	if (seekEntryCount > 0 && static_cast<u64>(seekTableOffset) + static_cast<u64>(seekEntryCount) * 8u > static_cast<u64>(dataOffset)) {
		result.startResult = {APU_FAULT_OUTPUT_METADATA, seekEntryCount};
		return result;
	}
	const size_t seekCount = seekEntryCount > 0 ? static_cast<size_t>(seekEntryCount) : 1u;
	result.frames.resize(seekCount);
	result.offsets.resize(seekCount);
	if (seekEntryCount > 0) {
		size_t cursor = static_cast<size_t>(seekTableOffset);
		for (size_t i = 0; i < seekCount; i += 1) {
			result.frames[i] = readLE32Audio(data + cursor);
			result.offsets[i] = readLE32Audio(data + cursor + 4);
			cursor += 8;
		}
	} else {
		result.frames[0] = 0;
		result.offsets[0] = 0;
	}
	if (result.frames[0] != 0 || result.offsets[0] != 0) {
		result.startResult = {APU_FAULT_OUTPUT_METADATA, result.offsets[0]};
		return result;
	}
	for (size_t i = 0; i < seekCount; i += 1) {
		if (result.frames[i] > source.frameCount || result.offsets[i] >= source.dataBytes) {
			result.startResult = {APU_FAULT_OUTPUT_METADATA, static_cast<u32>(i)};
			return result;
		}
		if (i > 0 && (result.frames[i] < result.frames[i - 1] || result.offsets[i] < result.offsets[i - 1])) {
			result.startResult = {APU_FAULT_OUTPUT_METADATA, static_cast<u32>(i)};
			return result;
		}
	}
	result.startResult = validateBadpBlocks(data, source, result.frames, result.offsets);
	return result;
}

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

static inline bool audioPositionIsInteger(f64 position) {
	return position == static_cast<f64>(audioFrameIndex(position));
}

static inline i16 readPcmSample(const i16* samples16, const u8* samples8, bool is16Bit, size_t sampleIndex) {
	if (is16Bit) {
		return samples16[sampleIndex];
	}
	return static_cast<i16>(static_cast<int>(samples8[sampleIndex]) - 128) << 8;
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
	if (position >= loopEnd) {
		position = loopStart + std::fmod(position - loopStart, loopLen);
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
	clearOutputQueue();
}

void ApuOutputMixer::clearOutputQueue() {
	m_outputQueueReadFrame = 0;
	m_outputQueueFrames = 0;
}

void ApuOutputMixer::pullOutputFrames(i16* output, size_t frameCount, i32 outputSampleRate, f32 outputGain, size_t targetQueuedFrames) {
	fillOutputQueueTo(frameCount, outputSampleRate, outputGain);
	readOutputQueue(output, frameCount);
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
	if (source.bitsPerSample == 4) {
		BadpSeekTableResult badpSeek = readBadpSeekTable(sourceBytes.data(), source.sourceBytes, source);
		if (badpSeek.startResult.faultCode != APU_FAULT_NONE) {
			return badpSeek.startResult;
		}
		badpSeekFrames = std::move(badpSeek.frames);
		badpSeekOffsets = std::move(badpSeek.offsets);
	} else {
		const ApuOutputStartResult pcmResult = validatePcmSourceData(source);
		if (pcmResult.faultCode != APU_FAULT_NONE) {
			return pcmResult;
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
			return {APU_FAULT_OUTPUT_METADATA, parameterIndex};
		case APU_PARAMETER_RATE_STEP_Q16_INDEX:
			playbackRate = static_cast<f32>(toSignedWord(registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX])) / static_cast<f32>(APU_RATE_STEP_Q16_ONE);
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
	if (m_mixBuffer.size() < totalSamples) {
		m_mixBuffer.resize(totalSamples);
	}
	std::fill(m_mixBuffer.begin(), m_mixBuffer.begin() + totalSamples, 0.0f);

	const f64 invOutputRate = 1.0 / static_cast<f64>(outputSampleRate);
	const f32 sampleScale = 1.0f / 32768.0f;
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
			const i16* samples16 = reinterpret_cast<const i16*>(data);
			const u8* samples8 = data;

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
				if (record.usesBadp) {
					size_t outIndex = 0;
					for (size_t frame = 0; frame < frameCount; ++frame) {
						if (consumeStopTimer(stopAfter, invOutputRate)) {
							ended = true;
							break;
						}
					if (hasLoop) {
						if (position < loopStart || position >= loopEnd) {
							position = loopStart + std::fmod(position - loopStart, loopLen);
							if (position < loopStart) {
								position += loopLen;
							}
						}
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
					if (!badpReadFrameAt(record, idx0, left0i, right0i)) {
						ended = true;
						break;
					}
					i16 left1i = left0i;
					i16 right1i = right0i;
						if (nextIndex != idx0 && !badpReadFrameAt(record, nextIndex, left1i, right1i)) {
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

						const f32 sample = static_cast<f32>(readPcmSample(samples16, samples8, is16Bit, posIndex)) * sampleScale;
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
						const f32 left = static_cast<f32>(readPcmSample(samples16, samples8, is16Bit, base)) * sampleScale;
						const f32 right = static_cast<f32>(readPcmSample(samples16, samples8, is16Bit, base + 1)) * sampleScale;
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

								i64 idx = 0;
								f64 frac = 0.0;
								size_t idx0 = 0;
								audioSamplePosition(position, idx, frac, idx0);
								const i64 idx1 = wrappedAudioIndex(idx + 1, loopStart, loopEnd);

								const f32 s0 = static_cast<f32>(readPcmSample(samples16, samples8, is16Bit, idx0)) * sampleScale;
								const f32 s1 = static_cast<f32>(readPcmSample(samples16, samples8, is16Bit, static_cast<size_t>(idx1))) * sampleScale;
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
							const f32 s0 = static_cast<f32>(readPcmSample(samples16, samples8, is16Bit, idx0)) * sampleScale;
							f32 s1 = 0.0f;
							const size_t idx1 = idx0 + 1;
							if (idx1 < framesInRecord) {
								s1 = static_cast<f32>(readPcmSample(samples16, samples8, is16Bit, idx1)) * sampleScale;
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

								i64 idx = 0;
								f64 frac = 0.0;
								size_t idx0 = 0;
								audioSamplePosition(position, idx, frac, idx0);
								const i64 idx1 = wrappedAudioIndex(idx + 1, loopStart, loopEnd);

							const size_t base0 = idx0 * static_cast<size_t>(channels);
							const size_t base1 = static_cast<size_t>(idx1) * static_cast<size_t>(channels);
							const f32 left0 = static_cast<f32>(readPcmSample(samples16, samples8, is16Bit, base0)) * sampleScale;
							const f32 right0 = static_cast<f32>(readPcmSample(samples16, samples8, is16Bit, base0 + 1)) * sampleScale;
							const f32 left1 = static_cast<f32>(readPcmSample(samples16, samples8, is16Bit, base1)) * sampleScale;
							const f32 right1 = static_cast<f32>(readPcmSample(samples16, samples8, is16Bit, base1 + 1)) * sampleScale;

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
							const f32 left0 = static_cast<f32>(readPcmSample(samples16, samples8, is16Bit, base0)) * sampleScale;
							const f32 right0 = static_cast<f32>(readPcmSample(samples16, samples8, is16Bit, base0 + 1)) * sampleScale;
							f32 left1 = 0.0f;
							f32 right1 = 0.0f;
							const size_t idx1 = idx0 + 1;
							if (idx1 < framesInRecord) {
								const size_t base1 = idx1 * static_cast<size_t>(channels);
								left1 = static_cast<f32>(readPcmSample(samples16, samples8, is16Bit, base1)) * sampleScale;
								right1 = static_cast<f32>(readPcmSample(samples16, samples8, is16Bit, base1 + 1)) * sampleScale;
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
	if (m_outputQueue.empty()) {
		m_outputQueue.resize(APU_OUTPUT_QUEUE_CAPACITY_FRAMES * 2u);
	}
	const size_t capacityFrames = m_outputQueue.size() / 2u;
	if (targetFrames > capacityFrames) {
		targetFrames = capacityFrames;
	}
	if (m_outputQueueFrames >= targetFrames) {
		return;
	}
	const size_t framesToRender = targetFrames - m_outputQueueFrames;
	const size_t renderSampleCount = framesToRender * 2u;
	if (m_outputRenderBuffer.size() < renderSampleCount) {
		m_outputRenderBuffer.resize(renderSampleCount);
	}
	renderSamples(m_outputRenderBuffer.data(), framesToRender, outputSampleRate, outputGain);
	writeOutputQueue(m_outputRenderBuffer.data(), framesToRender);
}

void ApuOutputMixer::writeOutputQueue(const i16* samples, size_t frameCount) {
	const size_t capacityFrames = m_outputQueue.size() / 2u;
	const size_t writeFrame = (m_outputQueueReadFrame + m_outputQueueFrames) % capacityFrames;
	size_t firstSpan = capacityFrames - writeFrame;
	if (firstSpan > frameCount) {
		firstSpan = frameCount;
	}
	const size_t firstSamples = firstSpan * 2u;
	std::copy_n(samples, firstSamples, m_outputQueue.data() + writeFrame * 2u);
	const size_t secondSpan = frameCount - firstSpan;
	if (secondSpan > 0u) {
		std::copy_n(samples + firstSamples, secondSpan * 2u, m_outputQueue.data());
	}
	m_outputQueueFrames += frameCount;
}

void ApuOutputMixer::readOutputQueue(i16* output, size_t frameCount) {
	const size_t capacityFrames = m_outputQueue.size() / 2u;
	size_t firstSpan = capacityFrames - m_outputQueueReadFrame;
	if (firstSpan > frameCount) {
		firstSpan = frameCount;
	}
	const size_t firstSamples = firstSpan * 2u;
	std::copy_n(m_outputQueue.data() + m_outputQueueReadFrame * 2u, firstSamples, output);
	const size_t secondSpan = frameCount - firstSpan;
	if (secondSpan > 0u) {
		std::copy_n(m_outputQueue.data(), secondSpan * 2u, output + firstSamples);
	}
	m_outputQueueReadFrame = (m_outputQueueReadFrame + frameCount) % capacityFrames;
	m_outputQueueFrames -= frameCount;
	if (m_outputQueueFrames == 0u) {
		m_outputQueueReadFrame = 0;
	}
}

void ApuOutputMixer::badpLoadBlock(VoiceRecord& record, size_t offset) {
	const u8* data = record.data;
	BadpDecoderState& badp = record.badp;
	const size_t blockFrames = static_cast<size_t>(readLE16Audio(data + offset));
	const size_t blockBytes = static_cast<size_t>(readLE16Audio(data + offset + 2));
	const size_t blockHeaderBytes = 4 + static_cast<size_t>(record.channels) * 4;
	const size_t blockEnd = offset + blockBytes;
	size_t cursor = offset + 4;
	for (i32 channel = 0; channel < record.channels; channel += 1) {
		badp.predictors[channel] = static_cast<i16>(readLE16Audio(data + cursor));
		const i32 stepIndex = static_cast<i32>(data[cursor + 2]);
		badp.stepIndices[channel] = stepIndex;
		cursor += 4;
	}
	badp.blockEnd = blockEnd;
	badp.blockFrames = blockFrames;
	badp.blockFrameIndex = 0;
	badp.payloadOffset = offset + blockHeaderBytes;
	badp.nibbleCursor = 0;
}

void ApuOutputMixer::badpSeekToFrame(VoiceRecord& record, size_t frame) {
	BadpDecoderState& badp = record.badp;
	if (frame == record.frames) {
		badp.nextFrame = frame;
		badp.decodedFrame = static_cast<i64>(frame) - 1;
		badp.decodedLeft = 0;
		badp.decodedRight = 0;
		return;
	}

	size_t seekIndex = 0;
	size_t lo = 0;
	size_t hi = record.badpSeekFrames.size() - 1;
	while (lo <= hi) {
		const size_t mid = (lo + hi) >> 1;
		if (record.badpSeekFrames[mid] <= frame) {
			seekIndex = mid;
			lo = mid + 1;
		} else {
			if (mid == 0) {
				break;
			}
			hi = mid - 1;
		}
	}

	size_t currentFrame = static_cast<size_t>(record.badpSeekFrames[seekIndex]);
	size_t cursor = static_cast<size_t>(record.badpSeekOffsets[seekIndex]);
	badpLoadBlock(record, cursor);
	while (currentFrame + badp.blockFrames <= frame) {
		currentFrame += badp.blockFrames;
		cursor = badp.blockEnd;
		badpLoadBlock(record, cursor);
	}
	badp.nextFrame = currentFrame;
	badp.decodedFrame = static_cast<i64>(currentFrame) - 1;
	while (badp.nextFrame <= frame) {
		badpDecodeNextFrame(record);
	}
}

void ApuOutputMixer::badpResetDecoder(VoiceRecord& record, size_t frame) {
	record.badp = BadpDecoderState{};
	badpSeekToFrame(record, frame);
}

void ApuOutputMixer::badpDecodeNextFrame(VoiceRecord& record) {
	BadpDecoderState& badp = record.badp;
	if (badp.blockFrameIndex >= badp.blockFrames) {
		badpLoadBlock(record, badp.blockEnd);
	}

	const u8* data = record.data;
	i32 left = 0;
	i32 right = 0;
	for (i32 channel = 0; channel < record.channels; channel += 1) {
		i32& predictor = badp.predictors[channel];
		i32& stepIndex = badp.stepIndices[channel];
		const size_t payloadIndex = badp.payloadOffset + (badp.nibbleCursor >> 1);
		const u8 packed = data[payloadIndex];
		const i32 code = (badp.nibbleCursor & 1) == 0 ? static_cast<i32>((packed >> 4) & 0x0f) : static_cast<i32>(packed & 0x0f);
		badp.nibbleCursor += 1;

		const i32 step = BADP_STEP_TABLE[stepIndex];
		i32 diff = step >> 3;
		if ((code & 4) != 0) diff += step;
		if ((code & 2) != 0) diff += step >> 1;
		if ((code & 1) != 0) diff += step >> 2;
		if ((code & 8) != 0) {
			predictor -= diff;
		} else {
			predictor += diff;
		}
		if (predictor < -32768) predictor = -32768;
		if (predictor > 32767) predictor = 32767;
		stepIndex += BADP_INDEX_TABLE[code];
		if (stepIndex < 0) stepIndex = 0;
		if (stepIndex > 88) stepIndex = 88;

		if (channel == 0) {
			left = predictor;
		} else {
			right = predictor;
		}
	}
	if (record.channels == 1) {
		right = left;
	}
	badp.blockFrameIndex += 1;
	badp.nextFrame += 1;
	badp.decodedFrame = static_cast<i64>(badp.nextFrame) - 1;
	badp.decodedLeft = static_cast<i16>(left);
	badp.decodedRight = static_cast<i16>(right);
}

bool ApuOutputMixer::badpReadFrameAt(VoiceRecord& record, size_t frame, i16& outLeft, i16& outRight) {
	if (frame >= record.frames) {
		return false;
	}
	BadpDecoderState& badp = record.badp;
	if (badp.decodedFrame == static_cast<i64>(frame)) {
		outLeft = badp.decodedLeft;
		outRight = badp.decodedRight;
		return true;
	}
	if (frame < badp.nextFrame) {
		badpSeekToFrame(record, frame);
	}
	while (badp.nextFrame <= frame) {
		badpDecodeNextFrame(record);
	}
	outLeft = badp.decodedLeft;
	outRight = badp.decodedRight;
	return true;
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
	record.badpSeekFrames = std::move(badpSeekFrames);
	record.badpSeekOffsets = std::move(badpSeekOffsets);
	if (source.loopEndSample > source.loopStartSample) {
		record.loopStartFrame = static_cast<f64>(source.loopStartSample);
		record.loopEndFrame = static_cast<f64>(source.loopEndSample);
	}
	record.slot = slot;
	record.playback = playback;
	record.data = sourceBytes.data() + source.dataOffset;
	record.usesBadp = source.bitsPerSample == 4;
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
		badpResetDecoder(record, static_cast<size_t>(audioFrameIndex(record.position)));
	}

	return record;
}

void ApuOutputMixer::removeVoice(size_t index) {
	if (index >= m_voices.size()) {
		throw BMSX_RUNTIME_ERROR("[ApuOutput] Active voice index is not owned by this mixer.");
	}
	m_voices.erase(m_voices.begin() + static_cast<std::ptrdiff_t>(index));
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
		badpResetDecoder(record, startFrame);
	}
}

f32 ApuOutputMixer::clampVolume(f32 value) const {
	if (value < 0.0f) return 0.0f;
	if (value > 1.0f) return 1.0f;
	return value;
}

} // namespace bmsx
