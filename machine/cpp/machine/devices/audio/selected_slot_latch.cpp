#include "machine/devices/audio/selected_slot_latch.h"

#include "spec/bmsx/io.h"
#include "machine/cpu/value.h"
#include "spec/audio/apu.h"
#include "machine/devices/audio/slot_bank.h"
#include "machine/devices/device_status.h"
#include "machine/memory/memory.h"

namespace bmsx {

ApuSelectedSlotLatch::ApuSelectedSlotLatch(Memory& memory, DeviceStatusLatch& status, ApuSlotBank& slots)
	: m_memory(memory)
	, m_status(status)
	, m_slots(slots) {}

void ApuSelectedSlotLatch::reset() {
	m_memory.writeValue(IO_APU_SELECTED_SOURCE_ADDR, valueNumber(0.0));
	m_status.setStatusFlag(APU_STATUS_SELECTED_SLOT_ACTIVE, false);
}

void ApuSelectedSlotLatch::refreshThunk(void* context, [[maybe_unused]] u32 addr, [[maybe_unused]] Value value, MappedBusSignals) {
	static_cast<ApuSelectedSlotLatch*>(context)->refresh();
}

void ApuSelectedSlotLatch::refresh() {
	const uint32_t slot = m_memory.readIoU32(IO_APU_SLOT) & APU_SLOT_INDEX_MASK;
	const bool active = (m_slots.activeMask() & (1u << slot)) != 0u;
	m_memory.writeIoValue(IO_APU_SELECTED_SOURCE_ADDR, valueNumber(active ? static_cast<double>(m_slots.registerWord(slot, APU_PARAMETER_SOURCE_ADDR_INDEX)) : 0.0));
	m_status.setStatusFlag(APU_STATUS_SELECTED_SLOT_ACTIVE, active);
}

} // namespace bmsx
