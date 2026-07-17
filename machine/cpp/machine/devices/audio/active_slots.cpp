#include "machine/devices/audio/active_slots.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/audio/event_latch.h"
#include "machine/devices/audio/output.h"
#include "machine/devices/audio/selected_slot_latch.h"
#include "machine/devices/audio/source.h"
#include "machine/devices/audio/slot_bank.h"
#include "machine/memory/memory.h"

namespace bmsx {

ApuActiveSlots::ApuActiveSlots(Memory& memory,
	ApuOutputMixer& audioOutput,
	ApuSourceDma& sourceDma,
	ApuEventLatch& eventLatch,
	ApuSlotBank& slots,
	ApuSelectedSlotLatch& selectedSlotLatch)
	: m_memory(memory)
	, m_audioOutput(audioOutput)
	, m_sourceDma(sourceDma)
	, m_eventLatch(eventLatch)
	, m_slots(slots)
	, m_selectedSlotLatch(selectedSlotLatch) {}

void ApuActiveSlots::writeActiveMask() {
	m_memory.writeIoValue(IO_APU_ACTIVE_MASK, valueNumber(static_cast<double>(m_slots.activeMask())));
	ApuSelectedSlotLatch::refreshThunk(&m_selectedSlotLatch, IO_APU_SLOT, valueNil());
}

void ApuActiveSlots::setActive(ApuAudioSlot slot, const ApuParameterRegisterWords& registerWords) {
	m_slots.setActive(slot, registerWords);
	writeActiveMask();
}

void ApuActiveSlots::stop(ApuAudioSlot slot) {
	m_slots.clearSlot(slot);
	m_sourceDma.clearSlot(slot);
	writeActiveMask();
}

void ApuActiveSlots::setPhase(ApuAudioSlot slot, ApuSlotPhase phase) {
	m_slots.setPhase(slot, phase);
	writeActiveMask();
}

void ApuActiveSlots::advance(i64 samples, i64 startSequence) {
	const u32 endedMask = m_audioOutput.renderMachineFrames(samples, startSequence);
	for (ApuAudioSlot slot = 0; slot < APU_SLOT_COUNT; slot += 1u) {
		if ((endedMask & (1u << slot)) != 0u) {
			const u32 sourceAddr = m_slots.sourceAddr(slot);
			stop(slot);
			m_eventLatch.emit(APU_EVENT_SLOT_ENDED, slot, sourceAddr);
		}
	}
}

} // namespace bmsx
