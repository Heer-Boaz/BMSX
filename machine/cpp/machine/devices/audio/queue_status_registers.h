#pragma once

#include "common/primitives.h"
#include "machine/cpu/cpu.h"

namespace bmsx {

class ApuCommandFifo;

class ApuQueueStatusRegisters final {
public:
	explicit ApuQueueStatusRegisters(const ApuCommandFifo& commandFifo);

	static Value readThunk(void* context, u32 addr);

private:
	const ApuCommandFifo& m_commandFifo;
};

} // namespace bmsx
