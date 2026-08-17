#include "machine/devices/audio/command_ingress.h"

#include "machine/devices/audio/command_fifo.h"
#include "machine/devices/audio/command_latch.h"
#include "spec/audio/apu.h"
#include "machine/devices/audio/service_clock.h"
#include "machine/devices/device_status.h"
#include "machine/scheduler/device.h"

namespace bmsx {

ApuCommandIngress::ApuCommandIngress(ApuCommandLatch& commandLatch,
	ApuCommandFifo& commandFifo,
	DeviceStatusLatch& fault,
	ApuServiceClock& serviceClock,
	DeviceScheduler& scheduler)
	: m_commandLatch(commandLatch)
	, m_commandFifo(commandFifo)
	, m_fault(fault)
	, m_serviceClock(serviceClock)
	, m_scheduler(scheduler) {}

void ApuCommandIngress::onCommandWriteThunk(void* context, [[maybe_unused]] u32 addr, u32 value, MappedBusSignals) {
	auto& ingress = *static_cast<ApuCommandIngress*>(context);
	const i64 nowCycles = ingress.m_scheduler.currentNowCycles();
	ingress.m_serviceClock.synchronize(nowCycles);
	const u32 command = value;
	switch (command) {
		case APU_CMD_PLAY:
		case APU_CMD_STOP_SLOT:
		case APU_CMD_SET_SLOT_GAIN:
		case APU_CMD_PAUSE_SLOT:
		case APU_CMD_RESUME_SLOT:
			ingress.m_commandFifo.enqueue(command, ingress.m_commandLatch.registerWords());
			ingress.m_serviceClock.scheduleNext(nowCycles);
			ingress.m_commandLatch.clear();
			return;
		case APU_CMD_NONE:
			ingress.m_serviceClock.scheduleNext(nowCycles);
			return;
		default:
			ingress.m_fault.raise(APU_FAULT_BAD_CMD, command);
			ingress.m_commandLatch.clear();
			ingress.m_serviceClock.scheduleNext(nowCycles);
			return;
	}
}

} // namespace bmsx
