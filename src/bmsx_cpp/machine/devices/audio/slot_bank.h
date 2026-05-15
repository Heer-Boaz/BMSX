#pragma once

#include "machine/devices/audio/contracts.h"

namespace bmsx {

struct ApuSlotAdvanceResult {
	bool ended = false;
	ApuVoiceId voiceId = 0u;
	uint32_t sourceAddr = 0u;
};

class ApuSlotBank {
public:
	uint32_t activeMask() const;
	void reset();
	void resetVoiceIds();
	ApuVoiceId allocateVoiceId();
	void assignVoiceId(ApuAudioSlot slot, ApuVoiceId voiceId);
	ApuVoiceId voiceId(ApuAudioSlot slot) const;
	ApuSlotPhase phase(ApuAudioSlot slot) const;
	void setPhase(ApuAudioSlot slot, ApuSlotPhase phase);
	void setActive(ApuAudioSlot slot, const ApuParameterRegisterWords& registerWords, ApuVoiceId voiceId);
	void clearSlot(ApuAudioSlot slot);
	uint32_t registerWord(ApuAudioSlot slot, uint32_t parameterIndex) const;
	void writeRegisterWord(ApuAudioSlot slot, uint32_t parameterIndex, uint32_t word);
	void loadRegisterWords(ApuAudioSlot slot, ApuParameterRegisterWords& out) const;
	int64_t playbackCursorQ16(ApuAudioSlot slot) const;
	void setPlaybackCursorQ16(ApuAudioSlot slot, int64_t cursorQ16);
	uint32_t fadeSamplesRemaining(ApuAudioSlot slot) const;
	void setFadeSamplesRemaining(ApuAudioSlot slot, uint32_t samples);
	uint32_t fadeSamplesTotal(ApuAudioSlot slot) const;
	void setFadeSamples(ApuAudioSlot slot, uint32_t samples);
	ApuSlotAdvanceResult advanceSlot(ApuAudioSlot slot, int64_t samples);
	const std::array<uint32_t, APU_SLOT_COUNT>& slotPhases() const;
	const std::array<uint32_t, APU_SLOT_REGISTER_WORD_COUNT>& slotRegisterWords() const;
	const std::array<int64_t, APU_SLOT_COUNT>& slotPlaybackCursorQ16() const;
	const std::array<uint32_t, APU_SLOT_COUNT>& slotFadeSamplesRemaining() const;
	const std::array<uint32_t, APU_SLOT_COUNT>& slotFadeSamplesTotal() const;
	void restore(
		const std::array<uint32_t, APU_SLOT_COUNT>& slotPhases,
		const std::array<uint32_t, APU_SLOT_REGISTER_WORD_COUNT>& slotRegisterWords,
		const std::array<int64_t, APU_SLOT_COUNT>& slotPlaybackCursorQ16,
		const std::array<uint32_t, APU_SLOT_COUNT>& slotFadeSamplesRemaining,
		const std::array<uint32_t, APU_SLOT_COUNT>& slotFadeSamplesTotal
	);

private:
	uint32_t m_activeMask = 0u;
	std::array<uint32_t, APU_SLOT_COUNT> m_slotPhases{};
	std::array<uint32_t, APU_SLOT_REGISTER_WORD_COUNT> m_slotRegisterWords{};
	std::array<int64_t, APU_SLOT_COUNT> m_slotPlaybackCursorQ16{};
	std::array<uint32_t, APU_SLOT_COUNT> m_slotFadeSamplesRemaining{};
	std::array<uint32_t, APU_SLOT_COUNT> m_slotFadeSamplesTotal{};
	std::array<ApuVoiceId, APU_SLOT_COUNT> m_slotVoiceIds{};
	ApuVoiceId m_nextVoiceId = 1u;
};

} // namespace bmsx
