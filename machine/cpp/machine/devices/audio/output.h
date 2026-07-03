#pragma once

#include "machine/devices/audio/badp_decoder.h"
#include "machine/devices/audio/biquad_filter.h"
#include "common/primitives.h"
#include "common/types.h"
#include "machine/devices/audio/contracts.h"
#include "machine/devices/audio/output_ring.h"
#include "machine/devices/audio/playback.h"
#include "machine/devices/audio/save_state.h"

#include <array>
#include <vector>

namespace bmsx {

struct ApuOutputStartResult {
	u32 faultCode = APU_FAULT_NONE;
	u32 faultDetail = 0;
};

class ApuOutputMixer final {
public:
	ApuOutputMixer() = default;
	ApuOutputRing outputRing;

	void resetPlaybackState();
	[[nodiscard]] auto captureState() const -> ApuOutputState;
	void restoreVoiceState(const ApuOutputVoiceState& state);
	void pullOutputFrames(i16* output, size_t frameCount, i32 outputSampleRate, f32 outputGain, size_t targetQueuedFrames = 0);
	auto playVoice(ApuAudioSlot slot, ApuVoiceId voiceId, const ApuAudioSource& source, const Span<const u8>& sourceBytes, const ApuParameterRegisterWords& registerWords, i64 playbackCursorQ16, u32 stopFadeSamples = 0) -> ApuOutputStartResult;
	auto writeSlotRegisterWord(ApuAudioSlot slot, const ApuAudioSource& source, const ApuParameterRegisterWords& registerWords, u32 parameterIndex, i64 playbackCursorQ16) -> ApuOutputStartResult;
	auto stopSlot(ApuAudioSlot slot, u32 fadeSamples = 0) -> bool;
	void stopAllVoices();
	void renderSamples(i16* output, size_t frameCount, i32 outputSampleRate, f32 outputGain);

private:
	struct VoiceRecord {
		ApuVoiceId voiceId = 0;
		i32 sampleRate = 0;
		i32 channels = 0;
		i32 bitsPerSample = 0;
		const u8* data = nullptr;
		size_t dataSize = 0;
		size_t frames = 0;
		u32 generatorKind = APU_GENERATOR_NONE;
		u32 generatorDutyQ12 = 0;
		std::vector<u32> badpSeekFrames;
		std::vector<u32> badpSeekOffsets;
		std::optional<f64> loopStartFrame;
		std::optional<f64> loopEndFrame;
		ApuAudioSlot slot = 0;
		ApuOutputPlayback playback;
		f64 position = 0.0;
		f64 step = 0.0;
		f32 gain = 1.0F;
		f32 targetGain = 1.0F;
		f64 gainRampRemaining = 0.0;
		f64 stopAfter = -1.0;
		i32 filterSampleRate = 0;
		BiquadFilterState filter;
		bool finalized = false;
		bool usesBadp = false;
		ApuBadpDecoderState badp;
	};

	friend auto captureApuOutputVoiceState(const VoiceRecord& record) -> ApuOutputVoiceState;
	friend void restoreApuOutputVoiceState(VoiceRecord& record, const ApuOutputVoiceState& state);

	auto buildVoiceFromData(ApuAudioSlot slot,
								ApuVoiceId voiceId,
								const ApuAudioSource& source,
								const Span<const u8>& sourceBytes,
								std::vector<u32> badpSeekFrames,
								std::vector<u32> badpSeekOffsets,
								const ApuOutputPlayback& playback,
								i64 playbackCursorQ16,
								f32 initialGain) -> VoiceRecord;
	[[nodiscard]] auto findSlotIndex(ApuAudioSlot slot) const -> std::optional<size_t>;
	void removeVoice(size_t index);
	auto stopVoiceAtIndex(size_t index, u32 fadeSamples) -> bool;
	auto findSlot(ApuAudioSlot slot) -> VoiceRecord*;
	[[nodiscard]] auto findSlot(ApuAudioSlot slot) const -> const VoiceRecord*;
	void rampVoiceGain(VoiceRecord& record, f32 target, f64 durationSec);
	void applyVoiceGainQ12(VoiceRecord& record, u32 gainQ12Word);
	void applyVoiceLoopBounds(VoiceRecord& record, const ApuAudioSource& source);
	void seekVoice(VoiceRecord& record, u32 startFrame, i64 playbackCursorQ16);
	void mixVoiceSample(VoiceRecord& record, f32* mix, size_t& outIndex, f32 left, f32 right, f32 gain);
	void fillOutputQueueTo(size_t targetFrames, i32 outputSampleRate, f32 outputGain);

	[[nodiscard]] auto clampVolume(f32 value) const -> f32;

	std::vector<VoiceRecord> m_voices;
	std::array<f32, APU_OUTPUT_QUEUE_CAPACITY_SAMPLES> m_mixBuffer{};
};

} // namespace bmsx
