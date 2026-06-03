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

void ApuCommandIngress::onCommandWrite() {
	const u32 command = m_memory.readIoU32(IO_APU_CMD);
	switch (command) {
		case APU_CMD_PLAY:
		case APU_CMD_STOP_SLOT:
		case APU_CMD_SET_SLOT_GAIN:
			if (enqueueCommand(command)) {
				m_serviceClock.scheduleNext(m_scheduler.currentNowCycles());
			}
			clearApuCommandLatch(m_memory);
			return;
		case APU_CMD_NONE:
			return;
		default:
			m_fault.raise(APU_FAULT_BAD_CMD, command);
			clearApuCommandLatch(m_memory);
			return;
	}
}

// disable-next-line single_line_method_pattern -- memory-map callbacks require a C-style thunk into the command-doorbell device owner.
void ApuCommandIngress::writeThunk(void* context, u32, Value) {
	static_cast<ApuCommandIngress*>(context)->onCommandWrite();
}

bool ApuCommandIngress::enqueueCommand(u32 command) {
	if (!m_commandFifo.enqueue(command, m_memory)) {
		m_fault.raise(APU_FAULT_CMD_FIFO_FULL, command);
		return false;
	}
	return true;
}

} // namespace bmsx
