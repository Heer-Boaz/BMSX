#include "machine/devices/audio/event_latch.h"

#include "spec/bmsx/io.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"

namespace bmsx {

ApuEventLatch::ApuEventLatch(Memory& memory, IrqController& irq)
	: m_memory(memory)
	, m_irq(irq) {}

void ApuEventLatch::reset() {
	m_eventSequence = 0;
	m_memory.writeIoU32(IO_APU_EVENT_KIND, APU_EVENT_NONE);
	m_memory.writeIoU32(IO_APU_EVENT_SLOT, 0u);
	m_memory.writeIoU32(IO_APU_EVENT_SOURCE_ADDR, 0u);
	m_memory.writeIoU32(IO_APU_EVENT_SEQ, 0u);
}

ApuEventLatchState ApuEventLatch::captureState() const {
	ApuEventLatchState state;
	state.eventSequence = m_eventSequence;
	state.eventKind = m_memory.readIoU32(IO_APU_EVENT_KIND);
	state.eventSlot = m_memory.readIoU32(IO_APU_EVENT_SLOT);
	state.eventSourceAddr = m_memory.readIoU32(IO_APU_EVENT_SOURCE_ADDR);
	return state;
}

void ApuEventLatch::restoreState(const ApuEventLatchState& state) {
	m_eventSequence = state.eventSequence;
	m_memory.writeIoU32(IO_APU_EVENT_KIND, state.eventKind);
	m_memory.writeIoU32(IO_APU_EVENT_SLOT, state.eventSlot);
	m_memory.writeIoU32(IO_APU_EVENT_SOURCE_ADDR, state.eventSourceAddr);
	m_memory.writeIoU32(IO_APU_EVENT_SEQ, m_eventSequence);
}

void ApuEventLatch::emit(u32 kind, ApuAudioSlot slot, u32 sourceAddr) {
	m_eventSequence += 1u;
	m_memory.writeIoU32(IO_APU_EVENT_KIND, kind);
	m_memory.writeIoU32(IO_APU_EVENT_SLOT, slot);
	m_memory.writeIoU32(IO_APU_EVENT_SOURCE_ADDR, sourceAddr);
	m_memory.writeIoU32(IO_APU_EVENT_SEQ, m_eventSequence);
	m_irq.raiseUser(IRQ_APU);
}

} // namespace bmsx
