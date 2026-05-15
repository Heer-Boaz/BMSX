#pragma once

namespace bmsx {

class ApuSlotBank;
class DeviceStatusLatch;
class Memory;

class ApuSelectedSlotLatch final {
public:
	ApuSelectedSlotLatch(Memory& memory, DeviceStatusLatch& status, ApuSlotBank& slots);

	void reset();
	void refresh();

private:
	Memory& m_memory;
	DeviceStatusLatch& m_status;
	ApuSlotBank& m_slots;
};

} // namespace bmsx
