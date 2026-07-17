#pragma once

#include "common/primitives.h"
#include "common/types.h"
#include "machine/devices/audio/badp_decoder.h"
#include "machine/devices/audio/biquad_filter.h"
#include "machine/devices/audio/contracts.h"
#include "machine/devices/audio/output_ring.h"
#include "machine/devices/audio/playback.h"
#include "machine/devices/audio/save_state.h"

#include <array>

namespace bmsx {

class ApuOutputMixer final {
public:
	static constexpr size_t MIX_BATCH_FRAMES = 128u;
	ApuOutputMixer();
	ApuOutputRing outputRing;

	void resetPlaybackState();
	[[nodiscard]] auto captureState() const -> ApuOutputState;
	void playVoice(
		ApuAudioSlot slot,
		const ApuAudioSource& source,
		const Span<const u8>& sourceBytes,
		const ApuParameterRegisterWords& registerWords
	);
	void replaceVoiceSource(
		ApuAudioSlot slot,
		const ApuAudioSource& source,
		const Span<const u8>& sourceBytes,
		const ApuParameterRegisterWords& registerWords
	);
	void restoreVoice(
		ApuAudioSlot slot,
		const ApuAudioSource& source,
		const Span<const u8>& sourceBytes,
		const ApuParameterRegisterWords& registerWords,
		const ApuOutputVoiceState& state
	);
	void writeSlotRegisterWord(
		ApuAudioSlot slot,
		const ApuAudioSource& source,
		const ApuParameterRegisterWords& registerWords,
		u32 parameterIndex
	);
	void stopSlot(ApuAudioSlot slot, u32 fadeSamples = 0);
	void stopAllVoices();
	[[nodiscard]] auto samplesUntilNextEvent(i64 limit) const -> i64;
	[[nodiscard]] auto renderMachineFrames(i64 frameCount, i64 startSequence) -> u32;

private:
	static constexpr size_t MIX_BATCH_SAMPLES = MIX_BATCH_FRAMES * 2u;

	struct VoiceRecord {
		bool active = false;
		ApuAudioSlot slot = 0;
		u32 channels = 0;
		u32 bitsPerSample = 0;
		const u8* sourceBytes = nullptr;
		size_t dataOffset = 0;
		size_t frames = 0;
		u32 generatorKind = APU_GENERATOR_NONE;
		u32 generatorDutyQ12 = 0;
		ApuBadpSeekTable badpSeekTable;
		i64 loopStartQ16 = -1;
		i64 loopEndQ16 = -1;
		i64 cursorQ16 = 0;
		i32 phaseRemainder = 0;
		i64 phaseStepQ16 = 0;
		i32 phaseStepRemainder = 0;
		f64 gain = 1.0;
		f64 fadeStartGain = 1.0;
		u32 fadeSamplesRemaining = 0;
		u32 fadeSamplesTotal = 0;
		BiquadFilterState filter;
		bool usesBadp = false;
		ApuBadpDecoderState badp;
	};

	friend auto captureApuOutputVoiceState(const VoiceRecord& record) -> ApuOutputVoiceState;
	friend void restoreApuOutputVoiceState(VoiceRecord& record, const ApuOutputVoiceState& state);

	[[nodiscard]] auto renderMachineBatch(size_t frameCount, i64 startSequence) -> u32;
	void buildVoiceFromData(
		VoiceRecord& record,
		const ApuAudioSource& source,
		const Span<const u8>& sourceBytes,
		u32 rateStepQ16Word,
		i64 cursorQ16,
		i32 phaseRemainder,
		f64 initialGain
	);
	void configurePhaseStep(VoiceRecord& record, u32 rateStepQ16Word, u32 sampleRateHz);
	void applyVoiceGainQ12(VoiceRecord& record, u32 gainQ12Word);
	void applyVoiceLoopBounds(VoiceRecord& record, const ApuAudioSource& source);
	void seekVoice(VoiceRecord& record, u32 startFrame);
	void readVoiceFrame(VoiceRecord& record, size_t frame);
	static auto wrapLoopCursor(i64 cursorQ16, i64 loopStartQ16, i64 loopEndQ16) -> i64;
	void configureRecordFilter(VoiceRecord& record, const ApuParameterRegisterWords& registerWords);

	std::array<VoiceRecord, APU_SLOT_COUNT> m_voices{};
	std::array<f32, MIX_BATCH_SAMPLES> m_mixBuffer{};
	std::array<i16, MIX_BATCH_SAMPLES> m_renderBuffer{};
	ApuPhaseStep m_phaseStep{};
	i32 m_sampledLeft = 0;
	i32 m_sampledRight = 0;
};

} // namespace bmsx
