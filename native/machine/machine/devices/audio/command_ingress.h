#pragma once

#include "common/primitives.h"
#include "machine/cpu/cpu.h"

namespace bmsx {

class ApuCommandFifo;
class ApuServiceClock;
class DeviceScheduler;
class DeviceStatusLatch;
class Memory;

class ApuCommandIngress final {
public:
	ApuCommandIngress(Memory& memory,
		ApuCommandFifo& commandFifo,
		DeviceStatusLatch& fault,
		ApuServiceClock& serviceClock,
		DeviceScheduler& scheduler);

	void onCommandWrite();
	static void writeThunk(void* context, u32 addr, Value value);

private:
	Memory& m_memory;
	ApuCommandFifo& m_commandFifo;
	DeviceStatusLatch& m_fault;
	ApuServiceClock& m_serviceClock;
	DeviceScheduler& m_scheduler;

	bool enqueueCommand(u32 command);
};

} // namespace bmsx
