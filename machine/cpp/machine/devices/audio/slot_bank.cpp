#include "machine/devices/audio/slot_bank.h"

namespace bmsx {

uint32_t ApuSlotBank::activeMask() const {
	return m_activeMask;
}

void ApuSlotBank::reset() {
	m_activeMask = 0u;
	m_slotPhases.fill(APU_SLOT_PHASE_IDLE);
	m_slotRegisterWords.fill(0u);
}

ApuSlotPhase ApuSlotBank::phase(ApuAudioSlot slot) const {
	return m_slotPhases[slot];
}

void ApuSlotBank::setPhase(ApuAudioSlot slot, ApuSlotPhase phase) {
	m_slotPhases[slot] = phase;
	const uint32_t bit = 1u << slot;
	if (phase == APU_SLOT_PHASE_IDLE) {
		m_activeMask &= ~bit;
	} else {
		m_activeMask |= bit;
	}
}

void ApuSlotBank::setActive(ApuAudioSlot slot, const ApuParameterRegisterWords& registerWords) {
	setPhase(slot, APU_SLOT_PHASE_PLAYING);
	const size_t base = apuSlotRegisterWordIndex(slot, 0u);
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		m_slotRegisterWords[base + index] = registerWords[index];
	}
}

void ApuSlotBank::clearSlot(ApuAudioSlot slot) {
	setPhase(slot, APU_SLOT_PHASE_IDLE);
	const size_t base = apuSlotRegisterWordIndex(slot, 0u);
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		m_slotRegisterWords[base + index] = 0u;
	}
}

uint32_t ApuSlotBank::registerWord(ApuAudioSlot slot, uint32_t parameterIndex) const {
	return m_slotRegisterWords[apuSlotRegisterWordIndex(slot, parameterIndex)];
}

void ApuSlotBank::writeRegisterWord(ApuAudioSlot slot, uint32_t parameterIndex, uint32_t word) {
	m_slotRegisterWords[apuSlotRegisterWordIndex(slot, parameterIndex)] = word;
}

void ApuSlotBank::loadRegisterWords(ApuAudioSlot slot, ApuParameterRegisterWords& out) const {
	const size_t base = apuSlotRegisterWordIndex(slot, 0u);
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		out[index] = m_slotRegisterWords[base + index];
	}
}

uint32_t ApuSlotBank::sourceAddr(ApuAudioSlot slot) const {
	return m_slotRegisterWords[apuSlotRegisterWordIndex(slot, APU_PARAMETER_SOURCE_ADDR_INDEX)];
}

const std::array<uint32_t, APU_SLOT_COUNT>& ApuSlotBank::slotPhases() const {
	return m_slotPhases;
}

const std::array<uint32_t, APU_SLOT_REGISTER_WORD_COUNT>& ApuSlotBank::slotRegisterWords() const {
	return m_slotRegisterWords;
}

void ApuSlotBank::restore(
	const std::array<uint32_t, APU_SLOT_COUNT>& slotPhases,
	const std::array<uint32_t, APU_SLOT_REGISTER_WORD_COUNT>& slotRegisterWords
) {
	m_activeMask = 0u;
	m_slotPhases = slotPhases;
	for (ApuAudioSlot slot = 0; slot < APU_SLOT_COUNT; slot += 1u) {
		if (m_slotPhases[slot] != APU_SLOT_PHASE_IDLE) {
			m_activeMask |= 1u << slot;
		}
	}
	m_slotRegisterWords = slotRegisterWords;
}

} // namespace bmsx
