/*
 * soundmaster.h - Host-side audio playback and mixing.
 *
 * This is the mixer behind the machine APU. Cart-visible audio is MMIO, not
 * SoundMaster.
 */

#pragma once

#include "biquad_filter.h"
#include "core/registry.h"
#include "../subscription.h"
#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace bmsx {

using VoiceId = u64;
using AudioSlot = u32;

struct FilterModulationParams {
	std::string type;
	f32 frequency = 0.0f;
	f32 q = 0.0f;
	f32 gain = 0.0f;
};

struct ModulationParams {
	f32 pitchDelta = 0.0f;
	f32 volumeDelta = 0.0f;
	f32 offset = 0.0f;
	f32 playbackRate = 1.0f;
	std::optional<FilterModulationParams> filter;
};

struct SoundMasterResolvedPlayRequest {
	f32 playbackRate = 1.0f;
	f32 gainLinear = 1.0f;
	f32 offsetSeconds = 0.0f;
	std::optional<FilterModulationParams> filter;
};

struct SoundMasterAudioSource {
	u32 sourceAddr = 0;
	u32 sourceBytes = 0;
	u32 sampleRateHz = 0;
	u32 channels = 0;
	u32 bitsPerSample = 0;
	u32 frameCount = 0;
	u32 dataOffset = 0;
	u32 dataBytes = 0;
	u32 loopStartSample = 0;
	u32 loopEndSample = 0;
};

struct ActiveVoiceInfo {
	AudioSlot slot = 0;
	VoiceId voiceId = 0;
	u32 sourceAddr = 0;
	ModulationParams params;
	f64 startedAt = 0.0;
	f64 startOffset = 0.0;
};

class SoundMaster final : public Registerable {
public:
	SoundMaster();
	~SoundMaster() override;

	const Identifier& registryId() const override;
	bool isRegistryPersistent() const override { return true; }

	void resetPlaybackState();
	void dispose();
	bool isRuntimeAudioReady() const { return true; }

	VoiceId playResolved(AudioSlot slot, const SoundMasterAudioSource& source, const u8* sourceBytes, const SoundMasterResolvedPlayRequest& request);
	bool setVoiceGainLinear(VoiceId voiceId, f32 gain);
	bool rampVoiceGainLinear(VoiceId voiceId, f32 target, f64 seconds);
	bool setSlotGainLinear(AudioSlot slot, f32 gain);
	bool rampSlotGainLinear(AudioSlot slot, f32 target, f64 seconds);
	bool stopVoiceById(VoiceId voiceId, std::optional<i32> fadeMs = std::nullopt);
	bool stopSlot(AudioSlot slot, std::optional<i32> fadeMs = std::nullopt);
	void stopAllVoices();

	f32 masterVolume() const { return m_masterVolume; }
	void setMasterVolume(f32 value);

	size_t activeCountBySlot(AudioSlot slot) const;
	std::vector<ActiveVoiceInfo> getActiveVoiceInfosBySlot(AudioSlot slot) const;
	std::optional<ModulationParams> currentModulationParamsBySlot(AudioSlot slot) const;
	std::optional<f64> currentTimeBySlot(AudioSlot slot) const;

	SubscriptionHandle addEndedListener(std::function<void(const ActiveVoiceInfo&)> listener);

	void renderSamples(i16* output, size_t frameCount, i32 outputSampleRate);

	f64 currentTimeSec() const { return m_audioTimeSec; }

private:
	struct BadpDecoderState {
		i32 predictors[2] = {0, 0};
		i32 stepIndices[2] = {0, 0};
		size_t nextFrame = 0;
		size_t blockEnd = 0;
		size_t blockFrames = 0;
		size_t blockFrameIndex = 0;
		size_t payloadOffset = 0;
		size_t nibbleCursor = 0;
		i64 decodedFrame = -1;
		i16 decodedLeft = 0;
		i16 decodedRight = 0;
	};

	struct VoiceRecord {
		VoiceId voiceId = 0;
		u32 sourceAddr = 0;
		i32 sampleRate = 0;
		i32 channels = 0;
		i32 bitsPerSample = 0;
		const u8* data = nullptr;
		size_t dataSize = 0;
		size_t frames = 0;
		std::vector<u32> badpSeekFrames;
		std::vector<u32> badpSeekOffsets;
		std::optional<f64> loopStartFrame;
		std::optional<f64> loopEndFrame;
		AudioSlot slot = 0;
		ModulationParams params;
		f64 startedAt = 0.0;
		f64 startOffset = 0.0;
		f64 position = 0.0;
		f64 step = 0.0;
		f32 gain = 1.0f;
		f32 targetGain = 1.0f;
		f64 gainRampRemaining = 0.0;
		f64 stopAfter = -1.0;
		i32 filterSampleRate = 0;
		BiquadFilterState filter;
		bool finalized = false;
		bool usesBadp = false;
		BadpDecoderState badp;
	};

	ModulationParams resolveResolvedPlayParams(const SoundMasterResolvedPlayRequest& request) const;

	VoiceId startVoiceFromData(AudioSlot slot,
								const SoundMasterAudioSource& source,
								const u8* audioData,
								std::vector<u32> badpSeekFrames,
								std::vector<u32> badpSeekOffsets,
								const ModulationParams& params,
								f32 initialGain);
	void removeVoice(size_t index);
	void finalizeVoiceEnd(const VoiceRecord& record);
	VoiceRecord* findVoice(VoiceId voiceId);
	const VoiceRecord* findVoice(VoiceId voiceId) const;
	VoiceRecord* findSlot(AudioSlot slot);
	const VoiceRecord* findSlot(AudioSlot slot) const;
	void rampVoiceGain(VoiceRecord& record, f32 target, f64 durationSec);
	void badpLoadBlock(VoiceRecord& record, size_t offset);
	void badpSeekToFrame(VoiceRecord& record, size_t frame);
	void badpResetDecoder(VoiceRecord& record, size_t frame);
	void badpDecodeNextFrame(VoiceRecord& record);
	bool badpReadFrameAt(VoiceRecord& record, size_t frame, i16& outLeft, i16& outRight);

	f32 clampVolume(f32 value) const;
	f64 effectivePlaybackRate(const ModulationParams& params) const;

	f32 m_masterVolume = 1.0f;
	f64 m_audioTimeSec = 0.0;

	std::vector<VoiceRecord> m_voices;
	std::vector<std::pair<u32, std::function<void(const ActiveVoiceInfo&)>>> m_endedListeners;

	std::vector<f32> m_mixBuffer;
	VoiceId m_nextVoiceId = 1;
	u32 m_nextListenerId = 1;
};

} // namespace bmsx
