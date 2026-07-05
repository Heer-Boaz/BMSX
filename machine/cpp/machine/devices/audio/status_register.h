#pragma once

#include "common/types.h"
#include "machine/cpu/cpu.h"

namespace bmsx {

class ApuCommandFifo;
class ApuOutputRing;
class ApuSlotBank;
class DeviceStatusLatch;

class ApuStatusRegister final {
public:
	ApuStatusRegister(const DeviceStatusLatch& fault, const ApuSlotBank& slots, const ApuCommandFifo& commandFifo, const ApuOutputRing& outputRing);

	static Value readThunk(void* context, u32 addr);

private:
	const DeviceStatusLatch& m_fault;
	const ApuSlotBank& m_slots;
	const ApuCommandFifo& m_commandFifo;
	const ApuOutputRing& m_outputRing;
};

} // namespace bmsx
