#pragma once

#include "machine/devices/audio/contracts.h"

namespace bmsx {

class ApuSlotBank {
public:
	uint32_t activeMask() const;
	void reset();
	ApuSlotPhase phase(ApuAudioSlot slot) const;
	void setPhase(ApuAudioSlot slot, ApuSlotPhase phase);
	void setActive(ApuAudioSlot slot, const ApuParameterRegisterWords& registerWords);
	void clearSlot(ApuAudioSlot slot);
	uint32_t registerWord(ApuAudioSlot slot, uint32_t parameterIndex) const;
	void writeRegisterWord(ApuAudioSlot slot, uint32_t parameterIndex, uint32_t word);
	void loadRegisterWords(ApuAudioSlot slot, ApuParameterRegisterWords& out) const;
	uint32_t sourceAddr(ApuAudioSlot slot) const;
	const std::array<uint32_t, APU_SLOT_COUNT>& slotPhases() const;
	const std::array<uint32_t, APU_SLOT_REGISTER_WORD_COUNT>& slotRegisterWords() const;
	void restore(
		const std::array<uint32_t, APU_SLOT_COUNT>& slotPhases,
		const std::array<uint32_t, APU_SLOT_REGISTER_WORD_COUNT>& slotRegisterWords
	);

private:
	uint32_t m_activeMask = 0u;
	std::array<uint32_t, APU_SLOT_COUNT> m_slotPhases{};
	std::array<uint32_t, APU_SLOT_REGISTER_WORD_COUNT> m_slotRegisterWords{};
};

} // namespace bmsx
