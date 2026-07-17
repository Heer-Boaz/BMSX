#pragma once

#include "machine/cpu/cpu.h"
#include "common/types.h"
#include "machine/memory/bus_master.h"

namespace bmsx {

class ApuSlotBank;
class DeviceStatusLatch;
class Memory;

class ApuSelectedSlotLatch final {
public:
	ApuSelectedSlotLatch(Memory& memory, DeviceStatusLatch& status, ApuSlotBank& slots);

	void reset();
	void refresh();
	static void refreshThunk(void* context, u32 addr, Value value, MappedBusMaster busMaster);

private:
	Memory& m_memory;
	DeviceStatusLatch& m_status;
	ApuSlotBank& m_slots;
};

} // namespace bmsx
