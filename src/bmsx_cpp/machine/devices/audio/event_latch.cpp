#include "machine/devices/audio/event_latch.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"

namespace bmsx {

ApuEventLatch::ApuEventLatch(Memory& memory, IrqController& irq)
	: m_memory(memory)
	, m_irq(irq) {}

void ApuEventLatch::reset() {
	m_eventSequence = 0;
	m_memory.writeValue(IO_APU_EVENT_KIND, valueNumber(static_cast<double>(APU_EVENT_NONE)));
	m_memory.writeValue(IO_APU_EVENT_SLOT, valueNumber(0.0));
	m_memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, valueNumber(0.0));
	m_memory.writeValue(IO_APU_EVENT_SEQ, valueNumber(0.0));
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
	m_memory.writeValue(IO_APU_EVENT_KIND, valueNumber(static_cast<double>(state.eventKind)));
	m_memory.writeValue(IO_APU_EVENT_SLOT, valueNumber(static_cast<double>(state.eventSlot)));
	m_memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, valueNumber(static_cast<double>(state.eventSourceAddr)));
	m_memory.writeValue(IO_APU_EVENT_SEQ, valueNumber(static_cast<double>(m_eventSequence)));
}

void ApuEventLatch::emit(u32 kind, ApuAudioSlot slot, u32 sourceAddr) {
	m_eventSequence += 1u;
	m_memory.writeValue(IO_APU_EVENT_KIND, valueNumber(static_cast<double>(kind)));
	m_memory.writeValue(IO_APU_EVENT_SLOT, valueNumber(static_cast<double>(slot)));
	m_memory.writeValue(IO_APU_EVENT_SOURCE_ADDR, valueNumber(static_cast<double>(sourceAddr)));
	m_memory.writeValue(IO_APU_EVENT_SEQ, valueNumber(static_cast<double>(m_eventSequence)));
	m_irq.raise(IRQ_APU);
}

} // namespace bmsx
