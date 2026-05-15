#pragma once

#include "common/types.h"
#include "machine/devices/audio/contracts.h"

namespace bmsx {

class IrqController;
class Memory;

struct ApuEventLatchState {
	u32 eventSequence = 0;
	u32 eventKind = APU_EVENT_NONE;
	u32 eventSlot = 0;
	u32 eventSourceAddr = 0;
};

class ApuEventLatch final {
public:
	ApuEventLatch(Memory& memory, IrqController& irq);

	void reset();
	ApuEventLatchState captureState() const;
	void restoreState(const ApuEventLatchState& state);
	void emit(u32 kind, ApuAudioSlot slot, u32 sourceAddr);

private:
	Memory& m_memory;
	IrqController& m_irq;
	u32 m_eventSequence = 0;
};

} // namespace bmsx
