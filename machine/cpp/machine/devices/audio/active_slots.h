#pragma once

#include "common/primitives.h"
#include "machine/devices/audio/contracts.h"

namespace bmsx {

class ApuEventLatch;
class ApuOutputMixer;
class ApuSelectedSlotLatch;
class ApuSlotBank;
class Memory;

class ApuActiveSlots final {
public:
	ApuActiveSlots(Memory& memory,
		ApuOutputMixer& audioOutput,
		ApuEventLatch& eventLatch,
		ApuSlotBank& slots,
		ApuSelectedSlotLatch& selectedSlotLatch);

	void writeActiveMask();
	void setActive(ApuAudioSlot slot, const ApuParameterRegisterWords& registerWords);
	void stop(ApuAudioSlot slot);
	void deactivate(ApuAudioSlot slot);
	void setPhase(ApuAudioSlot slot, ApuSlotPhase phase);
	void advance(i64 samples, i64 startSequence);

private:
	Memory& m_memory;
	ApuOutputMixer& m_audioOutput;
	ApuEventLatch& m_eventLatch;
	ApuSlotBank& m_slots;
	ApuSelectedSlotLatch& m_selectedSlotLatch;
};

} // namespace bmsx
