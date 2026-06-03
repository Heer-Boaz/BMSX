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

u32 ApuStatusRegister::read() const {
	u32 status = m_fault.status;
	if (m_slots.activeMask() != 0u || !m_commandFifo.empty()) {
		status |= APU_STATUS_BUSY;
	}
	if (m_commandFifo.empty()) {
		status |= APU_STATUS_CMD_FIFO_EMPTY;
	}
	if (m_commandFifo.full()) {
		status |= APU_STATUS_CMD_FIFO_FULL;
	}
	const size_t queuedFrames = m_outputRing.queuedFrames();
	if (queuedFrames == 0u) {
		status |= APU_STATUS_OUTPUT_EMPTY;
	}
	if (queuedFrames >= m_outputRing.capacityFrames()) {
		status |= APU_STATUS_OUTPUT_FULL;
	}
	return status;
}

} // namespace bmsx
