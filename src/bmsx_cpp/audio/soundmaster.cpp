/*
 * soundmaster.cpp - Host-side audio playback and mixing
 *
 * This is the output/mixer side of audio, not the console audio device.
 */

#include "soundmaster.h"
#include "core/engine.h"
#include "../machine/cpu/cpu.h"
#include "../machine/runtime/runtime.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <memory>
#include <stdexcept>

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

static bool isBadpSource(const u8* data, size_t size) {
	return size >= BADP_HEADER_SIZE
		&& data[0] == BADP_MAGIC[0]
		&& data[1] == BADP_MAGIC[1]
		&& data[2] == BADP_MAGIC[2]
		&& data[3] == BADP_MAGIC[3];
}

static void readBadpSeekTable(const u8* data,
							  size_t size,
							  const SoundMasterAudioSource& source,
							  std::vector<u32>& seekFrames,
							  std::vector<u32>& seekOffsets) {
	if (!isBadpSource(data, size)) {
		throw BMSX_RUNTIME_ERROR("Unsupported audio format. Expected BADP.");
	}
	const u16 version = readLE16Audio(data + 4);
	if (version != BADP_VERSION) {
		throw BMSX_RUNTIME_ERROR("Unsupported BADP version.");
	}
	const u32 channels = readLE16Audio(data + 6);
	const u32 sampleRate = readLE32Audio(data + 8);
	const u32 frames = readLE32Audio(data + 12);
	const u32 seekEntryCount = readLE32Audio(data + 28);
	const u32 seekTableOffset = readLE32Audio(data + 32);
	const u32 dataOffset = readLE32Audio(data + 36);
	if (channels != source.channels || sampleRate != source.sampleRateHz || frames != source.frameCount || dataOffset != source.dataOffset) {
		throw BMSX_RUNTIME_ERROR("BADP source metadata does not match APU source registers.");
	}
	if (dataOffset < BADP_HEADER_SIZE || dataOffset > size) {
		throw BMSX_RUNTIME_ERROR("BADP data offset is invalid.");
	}
	if (source.dataBytes == 0 || dataOffset + source.dataBytes > size) {
		throw BMSX_RUNTIME_ERROR("BADP data section exceeds source bytes.");
	}
	if (seekEntryCount > 0 && (seekTableOffset < BADP_HEADER_SIZE || seekTableOffset >= dataOffset)) {
		throw BMSX_RUNTIME_ERROR("BADP seek table offset is invalid.");
	}
	const size_t seekCount = seekEntryCount > 0 ? static_cast<size_t>(seekEntryCount) : 1u;
	seekFrames.resize(seekCount);
	seekOffsets.resize(seekCount);
	if (seekEntryCount > 0) {
		size_t cursor = static_cast<size_t>(seekTableOffset);
		for (size_t i = 0; i < seekCount; i += 1) {
			if (cursor + 8 > static_cast<size_t>(dataOffset)) {
				throw BMSX_RUNTIME_ERROR("BADP seek table exceeds bounds.");
			}
			seekFrames[i] = readLE32Audio(data + cursor);
			seekOffsets[i] = readLE32Audio(data + cursor + 4);
			cursor += 8;
		}
	} else {
		seekFrames[0] = 0;
		seekOffsets[0] = 0;
	}
	if (seekFrames[0] != 0 || seekOffsets[0] != 0) {
		throw BMSX_RUNTIME_ERROR("BADP seek table must start at frame 0 and offset 0.");
	}
	for (size_t i = 0; i < seekCount; i += 1) {
		if (seekFrames[i] > source.frameCount || seekOffsets[i] >= source.dataBytes) {
			throw BMSX_RUNTIME_ERROR("BADP seek table entry exceeds source bounds.");
		}
		if (i > 0 && (seekFrames[i] < seekFrames[i - 1] || seekOffsets[i] < seekOffsets[i - 1])) {
			throw BMSX_RUNTIME_ERROR("BADP seek table entries are not monotonic.");
		}
	}
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

static inline void audioSamplePosition(f64 position, i64& index, f64& frac, size_t& index0) {
	index = static_cast<i64>(position);
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

SoundMaster::SoundMaster() {
	resetPlaybackState();
}

SoundMaster::~SoundMaster() {
	dispose();
}

const Identifier& SoundMaster::registryId() const {
	static const Identifier id = "sm";
	return id;
}

void SoundMaster::resetPlaybackState() {
	m_voices.clear();
	m_audioTimeSec = 0.0;
	m_nextVoiceId = 1;
}

void SoundMaster::dispose() {
	resetPlaybackState();
}

VoiceId SoundMaster::playResolved(AudioSlot slot, const SoundMasterAudioSource& source, const u8* sourceBytes, const SoundMasterResolvedPlayRequest& request) {
	const ModulationParams params = resolveResolvedPlayParams(request);
	const f32 initialGain = clampVolume(std::pow(10.0f, params.volumeDelta / 20.0f));
	std::vector<u32> badpSeekFrames;
	std::vector<u32> badpSeekOffsets;
	if (source.bitsPerSample == 4) {
		readBadpSeekTable(sourceBytes, source.sourceBytes, source, badpSeekFrames, badpSeekOffsets);
	}
	return startVoiceFromData(
		slot,
		source,
		sourceBytes + source.dataOffset,
		std::move(badpSeekFrames),
		std::move(badpSeekOffsets),
		params,
		initialGain
	);
}

bool SoundMaster::setVoiceGainLinear(VoiceId voiceId, f32 gain) {
	VoiceRecord* record = findVoice(voiceId);
	if (!record) {
		return false;
	}
	const f32 clamped = clampVolume(gain);
	record->gain = clamped;
	record->targetGain = clamped;
	record->gainRampRemaining = 0.0;
	return true;
}

bool SoundMaster::rampVoiceGainLinear(VoiceId voiceId, f32 target, f64 seconds) {
	if (seconds <= 0.0) {
		return setVoiceGainLinear(voiceId, target);
	}
	VoiceRecord* record = findVoice(voiceId);
	if (!record) {
		return false;
	}
	rampVoiceGain(*record, clampVolume(target), seconds);
	return true;
}

bool SoundMaster::setSlotGainLinear(AudioSlot slot, f32 gain) {
	VoiceRecord* record = findSlot(slot);
	if (!record) {
		return false;
	}
	const f32 clamped = clampVolume(gain);
	record->gain = clamped;
	record->targetGain = clamped;
	record->gainRampRemaining = 0.0;
	return true;
}

bool SoundMaster::rampSlotGainLinear(AudioSlot slot, f32 target, f64 seconds) {
	if (seconds <= 0.0) {
		return setSlotGainLinear(slot, target);
	}
	VoiceRecord* record = findSlot(slot);
	if (!record) {
		return false;
	}
	rampVoiceGain(*record, clampVolume(target), seconds);
	return true;
}

bool SoundMaster::stopVoiceById(VoiceId voiceId, std::optional<i32> fadeMs) {
	for (size_t i = 0; i < m_voices.size(); ++i) {
		if (m_voices[i].voiceId != voiceId) {
			continue;
		}
		if (fadeMs.has_value() && fadeMs.value() > 0) {
			const f64 fadeSec = static_cast<f64>(fadeMs.value()) / 1000.0;
			rampVoiceGain(m_voices[i], MIN_GAIN, fadeSec);
			m_voices[i].stopAfter = fadeSec;
			return true;
		}
		removeVoice(i);
		return true;
	}
	return false;
}

bool SoundMaster::stopSlot(AudioSlot slot, std::optional<i32> fadeMs) {
	for (size_t i = 0; i < m_voices.size(); ++i) {
		if (m_voices[i].slot != slot) {
			continue;
		}
		if (fadeMs.has_value() && fadeMs.value() > 0) {
			const f64 fadeSec = static_cast<f64>(fadeMs.value()) / 1000.0;
			rampVoiceGain(m_voices[i], MIN_GAIN, fadeSec);
			m_voices[i].stopAfter = fadeSec;
			return true;
		}
		removeVoice(i);
		return true;
	}
	return false;
}

void SoundMaster::stopAllVoices() {
	while (!m_voices.empty()) {
		removeVoice(m_voices.size() - 1);
	}
}

void SoundMaster::setMasterVolume(f32 value) {
	m_masterVolume = clampVolume(value);
}

size_t SoundMaster::activeCountBySlot(AudioSlot slot) const {
	size_t count = 0;
	for (const auto& record : m_voices) {
		if (record.slot == slot) {
			count += 1;
		}
	}
	return count;
}

std::vector<ActiveVoiceInfo> SoundMaster::getActiveVoiceInfosBySlot(AudioSlot slot) const {
	std::vector<ActiveVoiceInfo> result;
	for (const auto& record : m_voices) {
		if (record.slot != slot) {
			continue;
		}
		result.push_back(ActiveVoiceInfo{
			record.slot,
			record.voiceId,
			record.sourceAddr,
			record.params,
			record.startedAt,
			record.startOffset,
		});
	}
	return result;
}

std::optional<ModulationParams> SoundMaster::currentModulationParamsBySlot(AudioSlot slot) const {
	const VoiceRecord* record = findSlot(slot);
	if (!record) return std::nullopt;
	return record->params;
}

std::optional<f64> SoundMaster::currentTimeBySlot(AudioSlot slot) const {
	const VoiceRecord* record = findSlot(slot);
	if (!record) return std::nullopt;
	return record->position / static_cast<f64>(record->sampleRate);
}

SubscriptionHandle SoundMaster::addEndedListener(std::function<void(const ActiveVoiceInfo&)> listener) {
	const u32 id = m_nextListenerId++;
	m_endedListeners.push_back({id, std::move(listener)});
	return SubscriptionHandle::create([this, id]() {
		auto& listeners = m_endedListeners;
		for (size_t i = 0; i < listeners.size(); ++i) {
			if (listeners[i].first == id) {
				listeners.erase(listeners.begin() + static_cast<std::ptrdiff_t>(i));
				break;
			}
		}
	});
}

void SoundMaster::renderSamples(i16* output, size_t frameCount, i32 outputSampleRate) {
	const size_t totalSamples = frameCount * 2;
	if (m_mixBuffer.size() < totalSamples) {
		m_mixBuffer.resize(totalSamples);
	}
	std::fill(m_mixBuffer.begin(), m_mixBuffer.begin() + totalSamples, 0.0f);

	// const auto mixStart = std::chrono::steady_clock::now();
	const f64 invOutputRate = 1.0 / static_cast<f64>(outputSampleRate);
	const f64 dt = static_cast<f64>(frameCount) * invOutputRate;

	const f32 sampleScale = 1.0f / 32768.0f;
	f32* mix = m_mixBuffer.data();

	for (size_t i = 0; i < m_voices.size();) {
			VoiceRecord& record = m_voices[i];
			const u8* data = record.data;
			const int channels = record.channels;
			const size_t framesInAsset = record.frames;
			if (framesInAsset == 0) {
				removeVoice(i);
				continue;
			}
			const bool is16Bit = record.bitsPerSample == 16;
			const i16* samples16 = reinterpret_cast<const i16*>(data);
			const u8* samples8 = data;
			const auto readSample = [&](size_t sampleIndex) -> i16 {
				if (is16Bit) {
					return samples16[sampleIndex];
				}
				return static_cast<i16>(static_cast<int>(samples8[sampleIndex]) - 128) << 8;
			};

			const f64 loopStart = record.loopStartFrame.value_or(0.0);
				const f64 loopEnd = record.loopEndFrame.value_or(static_cast<f64>(framesInAsset));
				const bool hasLoop = record.loopStartFrame.has_value() && loopEnd > loopStart;
				const f64 loopLen = loopEnd - loopStart;
				const f64 framesInAssetF = static_cast<f64>(framesInAsset);

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
			if (record.params.filter.has_value()) {
				if (record.filterSampleRate != outputSampleRate) {
					const auto& filter = record.params.filter.value();
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

				auto mixVoiceSample = [&](size_t& outIndex, f32 left, f32 right) {
					if (record.filter.enabled) {
						record.filter.processStereo(left, right);
					}
					mix[outIndex] += left * gain;
					mix[outIndex + 1] += right * gain;
					outIndex += 2;
				};
				auto mixInterpolatedStereo = [&](size_t& outIndex, f32 left0, f32 right0, f32 left1, f32 right1, f64 frac) {
					mixVoiceSample(outIndex, lerpAudioSample(left0, left1, frac), lerpAudioSample(right0, right1, frac));
				};

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
					} else if (position >= framesInAssetF) {
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
						} else if (static_cast<size_t>(idx1) >= framesInAsset) {
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
							mixInterpolatedStereo(outIndex, left0, right0, left1, right1, frac);

						if (hasLoop) {
							advanceLoopedAudioFrame(position, step, loopStart, loopEnd, loopLen, gain, rampRemaining, gainStep, invOutputRate);
						} else {
							advanceLinearAudioFrame(position, step, gain, rampRemaining, gainStep, invOutputRate);
						}
					}
			} else {
				const bool integerPos = position == std::floor(position);
				const bool loopAligned = !hasLoop || (loopStart == std::floor(loopStart) && loopEnd == std::floor(loopEnd));
				const bool fastPath = step == 1.0 && integerPos && loopAligned;

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
						if (!hasLoop && posIndex >= framesInAsset) {
							ended = true;
							break;
						}

						const f32 sample = static_cast<f32>(readSample(posIndex)) * sampleScale;
						mixVoiceSample(outIndex, sample, sample);

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
						if (!hasLoop && posIndex >= framesInAsset) {
							ended = true;
							break;
						}

						const size_t base = posIndex * static_cast<size_t>(channels);
						const f32 left = static_cast<f32>(readSample(base)) * sampleScale;
						const f32 right = static_cast<f32>(readSample(base + 1)) * sampleScale;
						mixVoiceSample(outIndex, left, right);

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

								const f32 s0 = static_cast<f32>(readSample(idx0)) * sampleScale;
								const f32 s1 = static_cast<f32>(readSample(static_cast<size_t>(idx1))) * sampleScale;
								const f32 sample = lerpAudioSample(s0, s1, frac);
								mixVoiceSample(outIndex, sample, sample);

									advanceLoopedAudioFrame(position, step, loopStart, loopEnd, loopLen, gain, rampRemaining, gainStep, invOutputRate);
							}
						} else {
							for (size_t frame = 0; frame < frameCount; ++frame) {
								if (consumeStopTimer(stopAfter, invOutputRate)) {
									ended = true;
									break;
								}
							if (position >= framesInAssetF) {
								ended = true;
								break;
							}

							i64 idx = 0;
							f64 frac = 0.0;
							size_t idx0 = 0;
							audioSamplePosition(position, idx, frac, idx0);
							const f32 s0 = static_cast<f32>(readSample(idx0)) * sampleScale;
							f32 s1 = 0.0f;
							const size_t idx1 = idx0 + 1;
							if (idx1 < framesInAsset) {
								s1 = static_cast<f32>(readSample(idx1)) * sampleScale;
							}
								const f32 sample = lerpAudioSample(s0, s1, frac);
								mixVoiceSample(outIndex, sample, sample);

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
							const f32 left0 = static_cast<f32>(readSample(base0)) * sampleScale;
							const f32 right0 = static_cast<f32>(readSample(base0 + 1)) * sampleScale;
							const f32 left1 = static_cast<f32>(readSample(base1)) * sampleScale;
							const f32 right1 = static_cast<f32>(readSample(base1 + 1)) * sampleScale;

									mixInterpolatedStereo(outIndex, left0, right0, left1, right1, frac);

									advanceLoopedAudioFrame(position, step, loopStart, loopEnd, loopLen, gain, rampRemaining, gainStep, invOutputRate);
							}
						} else {
							for (size_t frame = 0; frame < frameCount; ++frame) {
								if (consumeStopTimer(stopAfter, invOutputRate)) {
									ended = true;
									break;
								}
							if (position >= framesInAssetF) {
								ended = true;
								break;
							}

							i64 idx = 0;
							f64 frac = 0.0;
							size_t idx0 = 0;
							audioSamplePosition(position, idx, frac, idx0);
							const size_t base0 = idx0 * static_cast<size_t>(channels);
							const f32 left0 = static_cast<f32>(readSample(base0)) * sampleScale;
							const f32 right0 = static_cast<f32>(readSample(base0 + 1)) * sampleScale;
							f32 left1 = 0.0f;
							f32 right1 = 0.0f;
							const size_t idx1 = idx0 + 1;
							if (idx1 < framesInAsset) {
								const size_t base1 = idx1 * static_cast<size_t>(channels);
								left1 = static_cast<f32>(readSample(base1)) * sampleScale;
								right1 = static_cast<f32>(readSample(base1 + 1)) * sampleScale;
							}

									mixInterpolatedStereo(outIndex, left0, right0, left1, right1, frac);

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
		f32 v = mix[i] * m_masterVolume;
		if (v > 1.0f) v = 1.0f;
		if (v < -1.0f) v = -1.0f;
		output[i] = static_cast<i16>(std::lrint(v * 32767.0f));
	}

	// const auto mixEnd = std::chrono::steady_clock::now();
	// static f64 accAudioSec = 0.0;
	// static f64 accMixMs = 0.0;
	// static u64 accCalls = 0;
	// accAudioSec += dt;
	// accMixMs += std::chrono::duration<double, std::milli>(mixEnd - mixStart).count();
	// accCalls += 1;
	// if (accAudioSec >= 1.0) {
		// 	const size_t voiceCount = m_voices.size();
	// 	const f64 audioMs = accAudioSec * 1000.0;
	// 	const f64 loadPct = (accMixMs / audioMs) * 100.0;
	// 	std::fprintf(stderr,
		// 		"[BMSX] audio mix %.2fms / %.2fms (%.1f%%), calls=%llu, voices=%zu\n",
	// 		accMixMs,
	// 		audioMs,
	// 		loadPct,
		// 		static_cast<unsigned long long>(accCalls),
		// 		voiceCount);
	// 	accAudioSec = 0.0;
	// 	accMixMs = 0.0;
	// 	accCalls = 0;
	// }

	m_audioTimeSec += dt;
}

ModulationParams SoundMaster::resolveResolvedPlayParams(const SoundMasterResolvedPlayRequest& request) const {
	ModulationParams params;
	params.pitchDelta = 0.0f;
	params.volumeDelta = request.gainLinear > 0.0f ? 20.0f * std::log10(request.gainLinear) : -96.0f;
	params.offset = request.offsetSeconds;
	params.playbackRate = request.playbackRate;
	if (request.filter.has_value()) {
		params.filter = request.filter;
	}
	return params;
}

void SoundMaster::badpLoadBlock(VoiceRecord& record, size_t offset) {
	const u8* data = record.data;
	BadpDecoderState& badp = record.badp;
	if (offset + 4 > record.dataSize) {
		throw BMSX_RUNTIME_ERROR("BADP block header exceeds data.");
	}
	const size_t blockFrames = static_cast<size_t>(readLE16Audio(data + offset));
	const size_t blockBytes = static_cast<size_t>(readLE16Audio(data + offset + 2));
	if (blockFrames == 0) {
		throw BMSX_RUNTIME_ERROR("BADP block frame count is zero.");
	}
	const size_t blockHeaderBytes = 4 + static_cast<size_t>(record.channels) * 4;
	if (blockBytes < blockHeaderBytes) {
		throw BMSX_RUNTIME_ERROR("BADP block header length is invalid.");
	}
	const size_t blockEnd = offset + blockBytes;
	if (blockEnd > record.dataSize) {
		throw BMSX_RUNTIME_ERROR("BADP block exceeds bounds.");
	}
	size_t cursor = offset + 4;
	for (i32 channel = 0; channel < record.channels; channel += 1) {
		badp.predictors[channel] = static_cast<i16>(readLE16Audio(data + cursor));
		const i32 stepIndex = static_cast<i32>(data[cursor + 2]);
		if (stepIndex < 0 || stepIndex > 88) {
			throw BMSX_RUNTIME_ERROR("BADP step index out of range.");
		}
		badp.stepIndices[channel] = stepIndex;
		cursor += 4;
	}
	badp.blockEnd = blockEnd;
	badp.blockFrames = blockFrames;
	badp.blockFrameIndex = 0;
	badp.payloadOffset = offset + blockHeaderBytes;
	badp.nibbleCursor = 0;
}

void SoundMaster::badpSeekToFrame(VoiceRecord& record, size_t frame) {
	BadpDecoderState& badp = record.badp;
	if (frame > record.frames) {
		throw BMSX_RUNTIME_ERROR("BADP seek frame out of range.");
	}
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

void SoundMaster::badpResetDecoder(VoiceRecord& record, size_t frame) {
	record.badp = BadpDecoderState{};
	badpSeekToFrame(record, frame);
}

void SoundMaster::badpDecodeNextFrame(VoiceRecord& record) {
	BadpDecoderState& badp = record.badp;
	if (badp.nextFrame >= record.frames) {
		throw BMSX_RUNTIME_ERROR("BADP decode frame out of range.");
	}
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
		if (payloadIndex >= badp.blockEnd) {
			throw BMSX_RUNTIME_ERROR("BADP payload underrun.");
		}
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

bool SoundMaster::badpReadFrameAt(VoiceRecord& record, size_t frame, i16& outLeft, i16& outRight) {
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

VoiceId SoundMaster::startVoiceFromData(AudioSlot slot,
										const SoundMasterAudioSource& source,
										const u8* audioData,
										std::vector<u32> badpSeekFrames,
										std::vector<u32> badpSeekOffsets,
										const ModulationParams& params,
										f32 initialGain) {
	stopSlot(slot);
	VoiceRecord record;
	record.voiceId = m_nextVoiceId++;
	record.sourceAddr = source.sourceAddr;
	record.sampleRate = static_cast<i32>(source.sampleRateHz);
	record.channels = static_cast<i32>(source.channels);
	record.bitsPerSample = static_cast<i32>(source.bitsPerSample);
	record.dataSize = source.dataBytes;
	record.frames = source.frameCount;
	record.badpSeekFrames = std::move(badpSeekFrames);
	record.badpSeekOffsets = std::move(badpSeekOffsets);
	if (source.loopStartSample > 0) {
		record.loopStartFrame = static_cast<f64>(source.loopStartSample);
		if (source.loopEndSample > source.loopStartSample) {
			record.loopEndFrame = static_cast<f64>(source.loopEndSample);
		}
	}
	record.slot = slot;
	record.params = params;
	record.startedAt = m_audioTimeSec;
	record.data = audioData;
	record.usesBadp = source.bitsPerSample == 4;
	const size_t framesInAsset = record.frames;
	const f64 durationSec = framesInAsset > 0 ? static_cast<f64>(framesInAsset) / static_cast<f64>(record.sampleRate) : 0.0;
	f64 offset = params.offset;
	if (durationSec > 0.0) {
		if (record.loopStartFrame.has_value()) {
			offset = std::fmod(offset, durationSec);
			if (offset < 0.0) offset += durationSec;
		} else {
			if (offset < 0.0) offset = 0.0;
			if (offset > durationSec) offset = durationSec;
		}
	}
	const f64 rate = effectivePlaybackRate(params);
	if (rate <= 0.0) {
		throw BMSX_RUNTIME_ERROR("Playback rate must be positive");
	}
	record.startOffset = offset;
	record.position = offset * static_cast<f64>(record.sampleRate);
	record.step = rate;
	record.gain = initialGain;
	record.targetGain = initialGain;
	record.gainRampRemaining = 0.0;
	record.stopAfter = -1.0;
	if (record.usesBadp) {
		badpResetDecoder(record, static_cast<size_t>(std::floor(record.position)));
	}

	const VoiceId voiceId = record.voiceId;
	m_voices.push_back(record);
	return voiceId;
}

void SoundMaster::removeVoice(size_t index) {
	if (index >= m_voices.size()) return;
	VoiceRecord record = m_voices[index];
	m_voices.erase(m_voices.begin() + static_cast<std::ptrdiff_t>(index));
	finalizeVoiceEnd(record);
}

void SoundMaster::finalizeVoiceEnd(const VoiceRecord& record) {
	if (m_endedListeners.empty()) return;
	ActiveVoiceInfo info{
		record.slot,
		record.voiceId,
		record.sourceAddr,
		record.params,
		record.startedAt,
		record.startOffset,
	};
	// Dispatch against a snapshot so listener callbacks can safely unsubscribe
	// themselves (or other listeners) without invalidating this iteration.
	const auto listeners = m_endedListeners;
	for (const auto& entry : listeners) {
		entry.second(info);
	}
}

SoundMaster::VoiceRecord* SoundMaster::findVoice(VoiceId voiceId) {
	for (auto& record : m_voices) {
		if (record.voiceId == voiceId) {
			return &record;
		}
	}
	return nullptr;
}

const SoundMaster::VoiceRecord* SoundMaster::findVoice(VoiceId voiceId) const {
	for (const auto& record : m_voices) {
		if (record.voiceId == voiceId) {
			return &record;
		}
	}
	return nullptr;
}

SoundMaster::VoiceRecord* SoundMaster::findSlot(AudioSlot slot) {
	for (auto it = m_voices.rbegin(); it != m_voices.rend(); ++it) {
		if (it->slot == slot) {
			return &(*it);
		}
	}
	return nullptr;
}

const SoundMaster::VoiceRecord* SoundMaster::findSlot(AudioSlot slot) const {
	for (auto it = m_voices.rbegin(); it != m_voices.rend(); ++it) {
		if (it->slot == slot) {
			return &(*it);
		}
	}
	return nullptr;
}

void SoundMaster::rampVoiceGain(VoiceRecord& record, f32 target, f64 durationSec) {
	record.targetGain = target;
	record.gainRampRemaining = durationSec;
}

f32 SoundMaster::clampVolume(f32 value) const {
	if (value < 0.0f) return 0.0f;
	if (value > 1.0f) return 1.0f;
	return std::isfinite(value) ? value : 0.0f;
}

f64 SoundMaster::effectivePlaybackRate(const ModulationParams& params) const {
	return params.playbackRate * std::pow(2.0, params.pitchDelta / 12.0);
}

} // namespace bmsx
