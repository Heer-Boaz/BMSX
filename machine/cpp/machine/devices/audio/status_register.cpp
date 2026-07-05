#include "machine/devices/audio/status_register.h"

#include "machine/devices/audio/command_fifo.h"
#include "machine/devices/audio/contracts.h"
#include "machine/devices/audio/output_ring.h"
#include "machine/devices/audio/slot_bank.h"
#include "machine/devices/device_status.h"

namespace bmsx {

ApuStatusRegister::ApuStatusRegister(const DeviceStatusLatch& fault, const ApuSlotBank& slots, const ApuCommandFifo& commandFifo, const ApuOutputRing& outputRing)
	: m_fault(fault)
	, m_slots(slots)
	, m_commandFifo(commandFifo)
	, m_outputRing(outputRing) {}

Value ApuStatusRegister::readThunk(void* context, [[maybe_unused]] u32 addr) {
	auto& reg = *static_cast<ApuStatusRegister*>(context);
	u32 status = reg.m_fault.status;
	if (reg.m_slots.activeMask() != 0u || !reg.m_commandFifo.empty()) {
		status |= APU_STATUS_BUSY;
	}
	if (reg.m_commandFifo.empty()) {
		status |= APU_STATUS_CMD_FIFO_EMPTY;
	}
	if (reg.m_commandFifo.full()) {
		status |= APU_STATUS_CMD_FIFO_FULL;
	}
	const size_t queuedFrames = reg.m_outputRing.queuedFrames();
	if (queuedFrames == 0u) {
		status |= APU_STATUS_OUTPUT_EMPTY;
	}
	if (queuedFrames >= reg.m_outputRing.capacityFrames()) {
		status |= APU_STATUS_OUTPUT_FULL;
	}
	return valueNumber(static_cast<double>(status));
}

} // namespace bmsx
