#pragma once

#include "machine/devices/audio/contracts.h"

namespace bmsx {

class ApuSlotBank;
class DeviceStatusLatch;
class Memory;

class ApuSelectedSlotLatch final {
public:
	ApuSelectedSlotLatch(Memory& memory, DeviceStatusLatch& status, ApuSlotBank& slots);

	void refresh(ApuAudioSlot slot);

private:
	Memory& m_memory;
	DeviceStatusLatch& m_status;
	ApuSlotBank& m_slots;
};

} // namespace bmsx
