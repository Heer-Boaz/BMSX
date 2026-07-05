#include "machine/devices/audio/queue_status_registers.h"

#include "machine/bus/io.h"
#include "machine/devices/audio/command_fifo.h"
#include "machine/devices/audio/output_ring.h"

namespace bmsx {

ApuQueueStatusRegisters::ApuQueueStatusRegisters(const ApuCommandFifo& commandFifo, const ApuOutputRing& outputRing)
	: m_commandFifo(commandFifo)
	, m_outputRing(outputRing) {}

Value ApuQueueStatusRegisters::readThunk(void* context, u32 addr) {
	auto& regs = *static_cast<ApuQueueStatusRegisters*>(context);
	switch (addr) {
		case IO_APU_OUTPUT_QUEUED_FRAMES:
			return valueNumber(static_cast<double>(static_cast<u32>(regs.m_outputRing.queuedFrames())));
		case IO_APU_OUTPUT_FREE_FRAMES:
			return valueNumber(static_cast<double>(static_cast<u32>(regs.m_outputRing.freeFrames())));
		case IO_APU_OUTPUT_CAPACITY_FRAMES:
			return valueNumber(static_cast<double>(static_cast<u32>(regs.m_outputRing.capacityFrames())));
		case IO_APU_CMD_QUEUED:
			return valueNumber(static_cast<double>(regs.m_commandFifo.count()));
		case IO_APU_CMD_FREE:
			return valueNumber(static_cast<double>(regs.m_commandFifo.free()));
		case IO_APU_CMD_CAPACITY:
			return valueNumber(static_cast<double>(regs.m_commandFifo.capacity()));
	}
	throw BMSX_RUNTIME_ERROR("[APU] Queue-status register read was mapped to an unknown address.");
}

} // namespace bmsx
