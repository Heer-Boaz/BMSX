#pragma once

#include "common/primitives.h"
#include "machine/memory/bus_signals.h"

namespace bmsx {

class ApuCommandFifo;

class ApuQueueStatusRegisters final {
public:
	explicit ApuQueueStatusRegisters(const ApuCommandFifo& commandFifo);

	static u32 readThunk(void* context, u32 addr, MappedBusSignals busSignals);

private:
	const ApuCommandFifo& m_commandFifo;
};

} // namespace bmsx
