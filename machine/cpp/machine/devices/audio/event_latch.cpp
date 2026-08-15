#include "machine/devices/audio/event_latch.h"

#include "spec/bmsx/io.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"

namespace bmsx {

ApuEventLatch::ApuEventLatch(Memory& memory, IrqController& irq)
	: m_memory(memory)
	, m_irq(irq) {}

void ApuEventLatch::reset() {
	m_eventSequence = 0u;
	m_eventKind = APU_EVENT_NONE;
	m_eventSlot = 0u;
	m_eventSourceAddr = 0u;
	mirrorRegisters();
}

ApuEventLatchState ApuEventLatch::captureState() const {
	ApuEventLatchState state;
	state.eventSequence = m_eventSequence;
	state.eventKind = m_eventKind;
	state.eventSlot = m_eventSlot;
	state.eventSourceAddr = m_eventSourceAddr;
	return state;
}

void ApuEventLatch::restoreState(const ApuEventLatchState& state) {
	m_eventSequence = state.eventSequence;
	m_eventKind = state.eventKind;
	m_eventSlot = state.eventSlot;
	m_eventSourceAddr = state.eventSourceAddr;
	mirrorRegisters();
}

void ApuEventLatch::emit(u32 kind, ApuAudioSlot slot, u32 sourceAddr) {
	m_eventSequence += 1u;
	m_eventKind = kind;
	m_eventSlot = slot;
	m_eventSourceAddr = sourceAddr;
	mirrorRegisters();
	m_irq.raiseUser(IRQ_APU);
}

void ApuEventLatch::mirrorRegisters() {
	m_memory.writeIoU32(IO_APU_EVENT_KIND, m_eventKind);
	m_memory.writeIoU32(IO_APU_EVENT_SLOT, m_eventSlot);
	m_memory.writeIoU32(IO_APU_EVENT_SOURCE_ADDR, m_eventSourceAddr);
	m_memory.writeIoU32(IO_APU_EVENT_SEQ, m_eventSequence);
}

} // namespace bmsx
