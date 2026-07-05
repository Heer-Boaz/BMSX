#include "machine/devices/audio/command_ingress.h"

#include "machine/bus/io.h"
#include "machine/devices/audio/command_fifo.h"
#include "machine/devices/audio/command_latch.h"
#include "machine/devices/audio/contracts.h"
#include "machine/devices/audio/service_clock.h"
#include "machine/devices/device_status.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"

namespace bmsx {

ApuCommandIngress::ApuCommandIngress(Memory& memory,
	ApuCommandFifo& commandFifo,
	DeviceStatusLatch& fault,
	ApuServiceClock& serviceClock,
	DeviceScheduler& scheduler)
	: m_memory(memory)
	, m_commandFifo(commandFifo)
	, m_fault(fault)
	, m_serviceClock(serviceClock)
	, m_scheduler(scheduler) {}

void ApuCommandIngress::onCommandWriteThunk(void* context, [[maybe_unused]] u32 addr, [[maybe_unused]] Value value) {
	auto& ingress = *static_cast<ApuCommandIngress*>(context);
	const u32 command = ingress.m_memory.readIoU32(IO_APU_CMD);
	switch (command) {
		case APU_CMD_PLAY:
		case APU_CMD_STOP_SLOT:
		case APU_CMD_SET_SLOT_GAIN:
			ingress.m_commandFifo.enqueue(command, ingress.m_memory);
			ingress.m_serviceClock.scheduleNext(ingress.m_scheduler.currentNowCycles());
			clearApuCommandLatch(ingress.m_memory);
			return;
		case APU_CMD_NONE:
			return;
		default:
			ingress.m_fault.raise(APU_FAULT_BAD_CMD, command);
			clearApuCommandLatch(ingress.m_memory);
			return;
	}
}

} // namespace bmsx
