#pragma once

#include "common/primitives.h"
#include "machine/devices/audio/contracts.h"

namespace bmsx {

class ApuEventLatch;
class ApuOutputMixer;
class ApuSelectedSlotLatch;
class ApuSlotBank;
class ApuSourceDma;
class Memory;

class ApuActiveSlots final {
public:
	ApuActiveSlots(Memory& memory,
		ApuOutputMixer& audioOutput,
		ApuSourceDma& sourceDma,
		ApuEventLatch& eventLatch,
		ApuSlotBank& slots,
		ApuSelectedSlotLatch& selectedSlotLatch);

	void writeActiveMask();
	void setActive(ApuAudioSlot slot, const ApuParameterRegisterWords& registerWords, ApuVoiceId voiceId);
	void stop(ApuAudioSlot slot);
	void setPhase(ApuAudioSlot slot, ApuSlotPhase phase);
	void advance(i64 samples);

private:
	Memory& m_memory;
	ApuOutputMixer& m_audioOutput;
	ApuSourceDma& m_sourceDma;
	ApuEventLatch& m_eventLatch;
	ApuSlotBank& m_slots;
	ApuSelectedSlotLatch& m_selectedSlotLatch;

	void emitSlotEvent(ApuAudioSlot slot, ApuVoiceId voiceId, u32 sourceAddr);
};

} // namespace bmsx
