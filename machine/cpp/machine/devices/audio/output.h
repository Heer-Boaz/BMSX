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

class ApuOutputMixer final {
public:
	ApuOutputMixer();
	ApuOutputRing outputRing;

	void resetPlaybackState();
	[[nodiscard]] auto captureState() const -> ApuOutputState;
	void pullOutputFrames(i16* output, size_t frameCount, i32 outputSampleRate, f32 outputGain, size_t targetQueuedFrames = 0);
	void playVoice(ApuAudioSlot slot, ApuVoiceId voiceId, const ApuAudioSource& source, const Span<const u8>& sourceBytes, const ApuParameterRegisterWords& registerWords, i64 playbackCursorQ16, u32 stopFadeSamples = 0);
	void restoreVoice(ApuAudioSlot slot, ApuVoiceId voiceId, const ApuAudioSource& source, const Span<const u8>& sourceBytes, const ApuParameterRegisterWords& registerWords, i64 playbackCursorQ16, const ApuOutputVoiceState& state);
	void writeSlotRegisterWord(ApuAudioSlot slot, const ApuAudioSource& source, const ApuParameterRegisterWords& registerWords, u32 parameterIndex, i64 playbackCursorQ16);
	void stopSlot(ApuAudioSlot slot, u32 fadeSamples = 0);
	void stopAllVoices();
	void renderSamples(i16* output, size_t frameCount, i32 outputSampleRate, f32 outputGain);

private:
	struct VoiceRecord {
		bool active = false;
		ApuVoiceId voiceId = 0;
		i32 sampleRate = 0;
		i32 channels = 0;
		i32 bitsPerSample = 0;
		const u8* data;
		size_t dataSize = 0;
		size_t frames = 0;
		u32 generatorKind = APU_GENERATOR_NONE;
		u32 generatorDutyQ12 = 0;
		std::vector<u32> badpSeekFrames;
		std::vector<u32> badpSeekOffsets;
		f64 loopStartFrame = -1.0;
		f64 loopEndFrame = -1.0;
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

	void buildVoiceFromData(VoiceRecord& record,
								ApuVoiceId voiceId,
								const ApuAudioSource& source,
								const Span<const u8>& sourceBytes,
								const ApuOutputPlayback& playback,
								i64 playbackCursorQ16,
								f32 initialGain);
	void rampVoiceGain(VoiceRecord& record, f32 target, f64 durationSec);
	void applyVoiceGainQ12(VoiceRecord& record, u32 gainQ12Word);
	void applyVoiceLoopBounds(VoiceRecord& record, const ApuAudioSource& source);
	void seekVoice(VoiceRecord& record, u32 startFrame, i64 playbackCursorQ16);
	void mixVoiceSample(VoiceRecord& record, f32* mix, size_t& outIndex, f32 left, f32 right, f32 gain);
	void fillOutputQueueTo(size_t targetFrames, i32 outputSampleRate, f32 outputGain);

	[[nodiscard]] auto clampVolume(f32 value) const -> f32;

	std::array<u8, 1> m_emptySourceBytes{};
	std::array<VoiceRecord, APU_SLOT_COUNT> m_voices{};
	std::array<f32, APU_OUTPUT_QUEUE_CAPACITY_SAMPLES> m_mixBuffer{};
};

} // namespace bmsx
