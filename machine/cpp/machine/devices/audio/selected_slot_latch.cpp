#include "machine/devices/audio/selected_slot_latch.h"

#include "spec/bmsx/io.h"
#include "spec/audio/apu.h"
#include "machine/devices/audio/slot_bank.h"
#include "machine/devices/device_status.h"
#include "machine/memory/memory.h"

namespace bmsx {

ApuSelectedSlotLatch::ApuSelectedSlotLatch(Memory& memory, DeviceStatusLatch& status, ApuSlotBank& slots)
	: m_memory(memory)
	, m_status(status)
	, m_slots(slots) {}

void ApuSelectedSlotLatch::refresh(ApuAudioSlot slot) {
	const bool active = (m_slots.activeMask() & (1u << slot)) != 0u;
	m_memory.writeIoU32(IO_APU_SELECTED_SOURCE_ADDR, active ? m_slots.registerWord(slot, APU_PARAMETER_SOURCE_ADDR_INDEX) : 0u);
	m_status.setStatusFlag(APU_STATUS_SELECTED_SLOT_ACTIVE, active);
}

} // namespace bmsx
