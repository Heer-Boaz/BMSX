#pragma once

#include "machine/devices/audio/biquad_filter.h"
#include "common/types.h"
#include "machine/common/numeric.h"
#include "machine/devices/audio/contracts.h"

#include <optional>
#include <string_view>
#include <vector>

namespace bmsx {

struct ApuOutputFilter {
	std::string_view type;
	f32 frequency = 0.0f;
	f32 q = 0.0f;
	f32 gain = 0.0f;
};

struct ApuOutputPlayback {
	f32 playbackRate = 1.0f;
	f32 gainLinear = 1.0f;
	std::optional<ApuOutputFilter> filter;
};

struct ApuOutputStartResult {
	u32 faultCode = APU_FAULT_NONE;
	u32 faultDetail = 0;
};

inline f32 resolveApuGainLinear(u32 gainQ12Word) {
	return static_cast<f32>(toSignedWord(gainQ12Word)) / static_cast<f32>(APU_GAIN_Q12_ONE);
}

inline std::optional<ApuOutputFilter> resolveApuOutputFilter(const ApuParameterRegisterWords& registerWords) {
	const u32 filterKind = registerWords[APU_PARAMETER_FILTER_KIND_INDEX];
	if (filterKind == APU_FILTER_NONE) {
		return std::nullopt;
	}
	ApuOutputFilter filter;
	switch (filterKind) {
		case APU_FILTER_HIGHPASS:
			filter.type = "highpass";
			break;
		case APU_FILTER_BANDPASS:
			filter.type = "bandpass";
			break;
		case APU_FILTER_NOTCH:
			filter.type = "notch";
			break;
		case APU_FILTER_ALLPASS:
			filter.type = "allpass";
			break;
		case APU_FILTER_PEAKING:
			filter.type = "peaking";
			break;
		case APU_FILTER_LOWSHELF:
			filter.type = "lowshelf";
			break;
		case APU_FILTER_HIGHSHELF:
			filter.type = "highshelf";
			break;
		default:
			filter.type = "lowpass";
			break;
	}
	filter.frequency = static_cast<f32>(toSignedWord(registerWords[APU_PARAMETER_FILTER_FREQ_HZ_INDEX]));
	filter.q = static_cast<f32>(toSignedWord(registerWords[APU_PARAMETER_FILTER_Q_MILLI_INDEX])) / 1000.0f;
	filter.gain = static_cast<f32>(toSignedWord(registerWords[APU_PARAMETER_FILTER_GAIN_MILLIDB_INDEX])) / 1000.0f;
	return filter;
}

inline ApuOutputPlayback resolveApuOutputPlayback(const ApuParameterRegisterWords& registerWords) {
	ApuOutputPlayback playback;
	playback.playbackRate = static_cast<f32>(toSignedWord(registerWords[APU_PARAMETER_RATE_STEP_Q16_INDEX])) / static_cast<f32>(APU_RATE_STEP_Q16_ONE);
	playback.gainLinear = resolveApuGainLinear(registerWords[APU_PARAMETER_GAIN_Q12_INDEX]);
	playback.filter = resolveApuOutputFilter(registerWords);
	return playback;
}

class ApuOutputMixer final {
public:
	ApuOutputMixer() = default;

	void resetPlaybackState();
	void clearOutputQueue();
	size_t queuedOutputFrames() const { return m_outputQueueFrames; }
	size_t capacityOutputFrames() const { return APU_OUTPUT_QUEUE_CAPACITY_FRAMES; }
	size_t freeOutputFrames() const { return APU_OUTPUT_QUEUE_CAPACITY_FRAMES - m_outputQueueFrames; }
	void pullOutputFrames(i16* output, size_t frameCount, i32 outputSampleRate, f32 outputGain, size_t targetQueuedFrames = 0);
	ApuOutputStartResult playVoice(ApuAudioSlot slot, ApuVoiceId voiceId, const ApuAudioSource& source, const std::vector<u8>& sourceBytes, const ApuParameterRegisterWords& registerWords, i64 playbackCursorQ16, u32 stopFadeSamples = 0);
	ApuOutputStartResult writeSlotRegisterWord(ApuAudioSlot slot, const ApuAudioSource& source, const ApuParameterRegisterWords& registerWords, u32 parameterIndex, i64 playbackCursorQ16);
	bool stopSlot(ApuAudioSlot slot, u32 fadeSamples = 0);
	void stopAllVoices();
	void renderSamples(i16* output, size_t frameCount, i32 outputSampleRate, f32 outputGain);

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
		ApuVoiceId voiceId = 0;
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
		ApuAudioSlot slot = 0;
		ApuOutputPlayback playback;
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

	VoiceRecord buildVoiceFromData(ApuAudioSlot slot,
								ApuVoiceId voiceId,
								const ApuAudioSource& source,
								const std::vector<u8>& sourceBytes,
								std::vector<u32> badpSeekFrames,
								std::vector<u32> badpSeekOffsets,
								const ApuOutputPlayback& playback,
								i64 playbackCursorQ16,
								f32 initialGain);
	std::optional<size_t> findSlotIndex(ApuAudioSlot slot) const;
	void removeVoice(size_t index);
	bool stopVoiceAtIndex(size_t index, u32 fadeSamples);
	VoiceRecord* findSlot(ApuAudioSlot slot);
	const VoiceRecord* findSlot(ApuAudioSlot slot) const;
	void rampVoiceGain(VoiceRecord& record, f32 target, f64 durationSec);
	void applyVoiceGainQ12(VoiceRecord& record, u32 gainQ12Word);
	void applyVoiceLoopBounds(VoiceRecord& record, const ApuAudioSource& source);
	void seekVoice(VoiceRecord& record, u32 startFrame, i64 playbackCursorQ16);
	void mixVoiceSample(VoiceRecord& record, f32* mix, size_t& outIndex, f32 left, f32 right, f32 gain);
	void badpLoadBlock(VoiceRecord& record, size_t offset);
	void badpSeekToFrame(VoiceRecord& record, size_t frame);
	void badpResetDecoder(VoiceRecord& record, size_t frame);
	void badpDecodeNextFrame(VoiceRecord& record);
	bool badpReadFrameAt(VoiceRecord& record, size_t frame, i16& outLeft, i16& outRight);
	void fillOutputQueueTo(size_t targetFrames, i32 outputSampleRate, f32 outputGain);
	void writeOutputQueue(const i16* samples, size_t frameCount);
	void readOutputQueue(i16* output, size_t frameCount);

	f32 clampVolume(f32 value) const;

	std::vector<VoiceRecord> m_voices;
	std::vector<f32> m_mixBuffer;
	std::vector<i16> m_outputQueue;
	std::vector<i16> m_outputRenderBuffer;
	size_t m_outputQueueReadFrame = 0;
	size_t m_outputQueueFrames = 0;
};

} // namespace bmsx
