#pragma once

#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "machine/memory/bus_signals.h"

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

	static void onCommandWriteThunk(void* context, u32 addr, Value value, MappedBusSignals busSignals);

private:
	Memory& m_memory;
	ApuCommandFifo& m_commandFifo;
	DeviceStatusLatch& m_fault;
	ApuServiceClock& m_serviceClock;
	DeviceScheduler& m_scheduler;
};

} // namespace bmsx
