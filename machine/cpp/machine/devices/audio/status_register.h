#pragma once

#include "common/types.h"
#include "machine/memory/bus_signals.h"

namespace bmsx {

class ApuCommandFifo;
class ApuServiceClock;
class ApuSlotBank;
class DeviceScheduler;
class DeviceStatusLatch;

class ApuStatusRegister final {
public:
	ApuStatusRegister(
		const DeviceStatusLatch& fault,
		const ApuSlotBank& slots,
		const ApuCommandFifo& commandFifo,
		ApuServiceClock& serviceClock,
		DeviceScheduler& scheduler
	);

	static u32 readThunk(void* context, u32 addr, MappedBusSignals busSignals);

private:
	const DeviceStatusLatch& m_fault;
	const ApuSlotBank& m_slots;
	const ApuCommandFifo& m_commandFifo;
	ApuServiceClock& m_serviceClock;
	DeviceScheduler& m_scheduler;
};

} // namespace bmsx
