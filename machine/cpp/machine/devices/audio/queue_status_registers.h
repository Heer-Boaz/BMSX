#pragma once

#include "common/primitives.h"
#include "machine/cpu/cpu.h"
#include "machine/memory/bus_master.h"

namespace bmsx {

class ApuCommandFifo;

class ApuQueueStatusRegisters final {
public:
	explicit ApuQueueStatusRegisters(const ApuCommandFifo& commandFifo);

	static Value readThunk(void* context, u32 addr, MappedBusMaster busMaster);

private:
	const ApuCommandFifo& m_commandFifo;
};

} // namespace bmsx
