#pragma once

#include "common/primitives.h"
#include "machine/memory/bus_signals.h"

namespace bmsx {

class ApuCommandFifo;
class ApuCommandLatch;
class ApuServiceClock;
class DeviceScheduler;
class DeviceStatusLatch;

class ApuCommandIngress final {
public:
	ApuCommandIngress(ApuCommandLatch& commandLatch,
		ApuCommandFifo& commandFifo,
		DeviceStatusLatch& fault,
		ApuServiceClock& serviceClock,
		DeviceScheduler& scheduler);

	static void onCommandWriteThunk(void* context, u32 addr, u32 value, MappedBusSignals busSignals);

private:
	ApuCommandLatch& m_commandLatch;
	ApuCommandFifo& m_commandFifo;
	DeviceStatusLatch& m_fault;
	ApuServiceClock& m_serviceClock;
	DeviceScheduler& m_scheduler;
};

} // namespace bmsx
