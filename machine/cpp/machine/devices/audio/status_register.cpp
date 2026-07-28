#include "machine/devices/audio/status_register.h"

#include "machine/devices/audio/command_fifo.h"
#include "spec/audio/apu.h"
#include "machine/devices/audio/service_clock.h"
#include "machine/devices/audio/slot_bank.h"
#include "machine/devices/device_status.h"
#include "machine/scheduler/device.h"

namespace bmsx {

ApuStatusRegister::ApuStatusRegister(
	const DeviceStatusLatch& fault,
	const ApuSlotBank& slots,
	const ApuCommandFifo& commandFifo,
	ApuServiceClock& serviceClock,
	DeviceScheduler& scheduler
)
	: m_fault(fault)
	, m_slots(slots)
	, m_commandFifo(commandFifo)
	, m_serviceClock(serviceClock)
	, m_scheduler(scheduler) {}

Value ApuStatusRegister::readThunk(void* context, [[maybe_unused]] u32 addr, MappedBusSignals) {
	auto& reg = *static_cast<ApuStatusRegister*>(context);
	const i64 nowCycles = reg.m_scheduler.currentNowCycles();
	reg.m_serviceClock.synchronize(nowCycles);
	u32 status = reg.m_fault.status | reg.m_serviceClock.sampleTransferStatusBits();
	if (reg.m_slots.activeMask() != 0u || !reg.m_commandFifo.empty()) {
		status |= APU_STATUS_BUSY;
	}
	if (reg.m_commandFifo.empty()) {
		status |= APU_STATUS_CMD_FIFO_EMPTY;
	}
	if (reg.m_commandFifo.full()) {
		status |= APU_STATUS_CMD_FIFO_FULL;
	}
	return valueNumber(static_cast<double>(status));
}

} // namespace bmsx
