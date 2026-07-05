#include "machine/devices/audio/selected_slot_latch.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/devices/audio/contracts.h"
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

void ApuSelectedSlotLatch::refreshThunk(void* context, [[maybe_unused]] u32 addr, [[maybe_unused]] Value value) {
	auto& latch = *static_cast<ApuSelectedSlotLatch*>(context);
	const uint32_t slot = latch.m_memory.readIoU32(IO_APU_SLOT) & APU_SLOT_INDEX_MASK;
	const bool active = (latch.m_slots.activeMask() & (1u << slot)) != 0u;
	latch.m_memory.writeIoValue(IO_APU_SELECTED_SOURCE_ADDR, valueNumber(active ? static_cast<double>(latch.m_slots.registerWord(slot, APU_PARAMETER_SOURCE_ADDR_INDEX)) : 0.0));
	latch.m_status.setStatusFlag(APU_STATUS_SELECTED_SLOT_ACTIVE, active);
}

} // namespace bmsx
