#pragma once

#include "common/primitives.h"
#include "machine/cpu/cpu.h"

namespace bmsx {

class ApuCommandFifo;
class ApuOutputRing;

class ApuQueueStatusRegisters final {
public:
	ApuQueueStatusRegisters(const ApuCommandFifo& commandFifo, const ApuOutputRing& outputRing);

	static Value readThunk(void* context, u32 addr);

private:
	const ApuCommandFifo& m_commandFifo;
	const ApuOutputRing& m_outputRing;
};

} // namespace bmsx
