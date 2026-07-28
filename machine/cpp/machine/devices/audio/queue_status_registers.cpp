#include "machine/devices/audio/queue_status_registers.h"

#include "spec/bmsx/io.h"
#include "machine/devices/audio/command_fifo.h"

namespace bmsx {

ApuQueueStatusRegisters::ApuQueueStatusRegisters(const ApuCommandFifo& commandFifo)
	: m_commandFifo(commandFifo) {}

u32 ApuQueueStatusRegisters::readThunk(void* context, u32 addr, MappedBusSignals) {
	auto& regs = *static_cast<ApuQueueStatusRegisters*>(context);
	switch (addr) {
		case IO_APU_CMD_QUEUED:
			return regs.m_commandFifo.count();
		case IO_APU_CMD_FREE:
			return regs.m_commandFifo.free();
		case IO_APU_CMD_CAPACITY:
			return regs.m_commandFifo.capacity();
	}
	throw BMSX_RUNTIME_ERROR("[APU] Queue-status register read was mapped to an unknown address.");
}

} // namespace bmsx
