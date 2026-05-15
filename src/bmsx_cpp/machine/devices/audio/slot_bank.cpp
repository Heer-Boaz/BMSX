#include "machine/devices/audio/slot_bank.h"

#include "machine/common/numeric.h"

namespace bmsx {
namespace {

bool advanceSlotCursor(
	std::array<uint32_t, APU_SLOT_REGISTER_WORD_COUNT>& slotRegisterWords,
	std::array<int64_t, APU_SLOT_COUNT>& slotPlaybackCursorQ16,
	ApuAudioSlot slot,
	int64_t samples
) {
	const size_t base = apuSlotRegisterWordIndex(slot, 0u);
	const int64_t rateStepQ16 = toSignedWord(slotRegisterWords[base + APU_PARAMETER_RATE_STEP_Q16_INDEX]);
	const uint32_t sourceSampleRateHz = slotRegisterWords[base + APU_PARAMETER_SOURCE_SAMPLE_RATE_HZ_INDEX];
	const int64_t loopStartQ16 = static_cast<int64_t>(slotRegisterWords[base + APU_PARAMETER_SOURCE_LOOP_START_SAMPLE_INDEX]) * static_cast<int64_t>(APU_RATE_STEP_Q16_ONE);
	const int64_t loopEndQ16 = static_cast<int64_t>(slotRegisterWords[base + APU_PARAMETER_SOURCE_LOOP_END_SAMPLE_INDEX]) * static_cast<int64_t>(APU_RATE_STEP_Q16_ONE);
	int64_t cursorQ16 = advanceApuPlaybackCursorQ16(slotPlaybackCursorQ16[slot], samples, rateStepQ16, sourceSampleRateHz);
	if (loopEndQ16 > loopStartQ16) {
		if (cursorQ16 >= loopEndQ16) {
			const int64_t loopLengthQ16 = loopEndQ16 - loopStartQ16;
			cursorQ16 = loopStartQ16 + ((cursorQ16 - loopStartQ16) % loopLengthQ16);
		}
		slotPlaybackCursorQ16[slot] = cursorQ16;
		return false;
	}
	slotPlaybackCursorQ16[slot] = cursorQ16;
	const int64_t frameEndQ16 = static_cast<int64_t>(slotRegisterWords[base + APU_PARAMETER_SOURCE_FRAME_COUNT_INDEX]) * static_cast<int64_t>(APU_RATE_STEP_Q16_ONE);
	return rateStepQ16 > 0 && cursorQ16 >= frameEndQ16;
}

} // namespace

uint32_t ApuSlotBank::activeMask() const {
	return m_activeMask;
}

void ApuSlotBank::reset() {
	m_activeMask = 0u;
	m_slotPhases.fill(APU_SLOT_PHASE_IDLE);
	m_slotRegisterWords.fill(0u);
	m_slotPlaybackCursorQ16.fill(0);
	m_slotFadeSamplesRemaining.fill(0u);
	m_slotFadeSamplesTotal.fill(0u);
	resetVoiceIds();
}

void ApuSlotBank::resetVoiceIds() {
	m_slotVoiceIds.fill(0u);
	m_nextVoiceId = 1u;
}

ApuVoiceId ApuSlotBank::allocateVoiceId() {
	m_nextVoiceId += 1u;
	return m_nextVoiceId - 1u;
}

void ApuSlotBank::assignVoiceId(ApuAudioSlot slot, ApuVoiceId voiceId) {
	m_slotVoiceIds[slot] = voiceId;
}

ApuVoiceId ApuSlotBank::voiceId(ApuAudioSlot slot) const {
	return m_slotVoiceIds[slot];
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

void ApuSlotBank::setActive(ApuAudioSlot slot, const ApuParameterRegisterWords& registerWords, ApuVoiceId voiceId) {
	setPhase(slot, APU_SLOT_PHASE_PLAYING);
	const size_t base = apuSlotRegisterWordIndex(slot, 0u);
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		m_slotRegisterWords[base + index] = registerWords[index];
	}
	m_slotPlaybackCursorQ16[slot] = static_cast<int64_t>(registerWords[APU_PARAMETER_START_SAMPLE_INDEX]) * static_cast<int64_t>(APU_RATE_STEP_Q16_ONE);
	m_slotFadeSamplesRemaining[slot] = 0u;
	m_slotFadeSamplesTotal[slot] = 0u;
	m_slotVoiceIds[slot] = voiceId;
}

void ApuSlotBank::clearSlot(ApuAudioSlot slot) {
	setPhase(slot, APU_SLOT_PHASE_IDLE);
	const size_t base = apuSlotRegisterWordIndex(slot, 0u);
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		m_slotRegisterWords[base + index] = 0u;
	}
	m_slotPlaybackCursorQ16[slot] = 0;
	m_slotFadeSamplesRemaining[slot] = 0u;
	m_slotFadeSamplesTotal[slot] = 0u;
	m_slotVoiceIds[slot] = 0u;
}

uint32_t ApuSlotBank::registerWord(ApuAudioSlot slot, uint32_t parameterIndex) const {
	return m_slotRegisterWords[apuSlotRegisterWordIndex(slot, parameterIndex)];
}

void ApuSlotBank::writeRegisterWord(ApuAudioSlot slot, uint32_t parameterIndex, uint32_t word) {
	m_slotRegisterWords[apuSlotRegisterWordIndex(slot, parameterIndex)] = word;
	if (parameterIndex == APU_PARAMETER_START_SAMPLE_INDEX) {
		m_slotPlaybackCursorQ16[slot] = static_cast<int64_t>(word) * static_cast<int64_t>(APU_RATE_STEP_Q16_ONE);
	}
}

void ApuSlotBank::loadRegisterWords(ApuAudioSlot slot, ApuParameterRegisterWords& out) const {
	const size_t base = apuSlotRegisterWordIndex(slot, 0u);
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		out[index] = m_slotRegisterWords[base + index];
	}
}

int64_t ApuSlotBank::playbackCursorQ16(ApuAudioSlot slot) const {
	return m_slotPlaybackCursorQ16[slot];
}

void ApuSlotBank::setPlaybackCursorQ16(ApuAudioSlot slot, int64_t cursorQ16) {
	m_slotPlaybackCursorQ16[slot] = cursorQ16;
}

uint32_t ApuSlotBank::fadeSamplesRemaining(ApuAudioSlot slot) const {
	return m_slotFadeSamplesRemaining[slot];
}

void ApuSlotBank::setFadeSamplesRemaining(ApuAudioSlot slot, uint32_t samples) {
	m_slotFadeSamplesRemaining[slot] = samples;
}

uint32_t ApuSlotBank::fadeSamplesTotal(ApuAudioSlot slot) const {
	return m_slotFadeSamplesTotal[slot];
}

void ApuSlotBank::setFadeSamples(ApuAudioSlot slot, uint32_t samples) {
	m_slotFadeSamplesRemaining[slot] = samples;
	m_slotFadeSamplesTotal[slot] = samples;
}

ApuSlotAdvanceResult ApuSlotBank::advanceSlot(ApuAudioSlot slot, int64_t samples) {
	ApuSlotAdvanceResult result;
	const ApuSlotPhase slotPhase = m_slotPhases[slot];
	if (slotPhase == APU_SLOT_PHASE_IDLE) {
		return result;
	}
	bool ended = false;
	const uint32_t fadeSamples = m_slotFadeSamplesRemaining[slot];
	if (slotPhase == APU_SLOT_PHASE_FADING) {
		const int64_t cursorSamples = samples < static_cast<int64_t>(fadeSamples) ? samples : static_cast<int64_t>(fadeSamples);
		const bool endedByCursor = advanceSlotCursor(m_slotRegisterWords, m_slotPlaybackCursorQ16, slot, cursorSamples);
		if (samples < static_cast<int64_t>(fadeSamples)) {
			m_slotFadeSamplesRemaining[slot] = static_cast<uint32_t>(static_cast<int64_t>(fadeSamples) - samples);
			if (!endedByCursor) {
				return result;
			}
			m_slotFadeSamplesRemaining[slot] = 0u;
		} else {
			m_slotFadeSamplesRemaining[slot] = 0u;
		}
		ended = true;
	} else {
		ended = advanceSlotCursor(m_slotRegisterWords, m_slotPlaybackCursorQ16, slot, samples);
	}
	if (ended) {
		result.ended = true;
		result.voiceId = m_slotVoiceIds[slot];
		result.sourceAddr = m_slotRegisterWords[apuSlotRegisterWordIndex(slot, APU_PARAMETER_SOURCE_ADDR_INDEX)];
	}
	return result;
}

const std::array<uint32_t, APU_SLOT_COUNT>& ApuSlotBank::slotPhases() const {
	return m_slotPhases;
}

const std::array<uint32_t, APU_SLOT_REGISTER_WORD_COUNT>& ApuSlotBank::slotRegisterWords() const {
	return m_slotRegisterWords;
}

const std::array<int64_t, APU_SLOT_COUNT>& ApuSlotBank::slotPlaybackCursorQ16() const {
	return m_slotPlaybackCursorQ16;
}

const std::array<uint32_t, APU_SLOT_COUNT>& ApuSlotBank::slotFadeSamplesRemaining() const {
	return m_slotFadeSamplesRemaining;
}

const std::array<uint32_t, APU_SLOT_COUNT>& ApuSlotBank::slotFadeSamplesTotal() const {
	return m_slotFadeSamplesTotal;
}

void ApuSlotBank::restore(
	const std::array<uint32_t, APU_SLOT_COUNT>& slotPhases,
	const std::array<uint32_t, APU_SLOT_REGISTER_WORD_COUNT>& slotRegisterWords,
	const std::array<int64_t, APU_SLOT_COUNT>& slotPlaybackCursorQ16,
	const std::array<uint32_t, APU_SLOT_COUNT>& slotFadeSamplesRemaining,
	const std::array<uint32_t, APU_SLOT_COUNT>& slotFadeSamplesTotal
) {
	resetVoiceIds();
	m_activeMask = 0u;
	m_slotPhases = slotPhases;
	for (ApuAudioSlot slot = 0; slot < APU_SLOT_COUNT; slot += 1u) {
		if (m_slotPhases[slot] != APU_SLOT_PHASE_IDLE) {
			m_activeMask |= 1u << slot;
		}
	}
	m_slotRegisterWords = slotRegisterWords;
	m_slotPlaybackCursorQ16 = slotPlaybackCursorQ16;
	m_slotFadeSamplesRemaining = slotFadeSamplesRemaining;
	m_slotFadeSamplesTotal = slotFadeSamplesTotal;
}

} // namespace bmsx
