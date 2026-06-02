#pragma once

#include "common/types.h"

namespace bmsx {

class ApuCommandFifo;
class ApuOutputRing;
class ApuSlotBank;
class DeviceStatusLatch;

class ApuStatusRegister final {
public:
	ApuStatusRegister(const DeviceStatusLatch& fault, const ApuSlotBank& slots, const ApuCommandFifo& commandFifo, const ApuOutputRing& outputRing);

	u32 read() const;

private:
	const DeviceStatusLatch& m_fault;
	const ApuSlotBank& m_slots;
	const ApuCommandFifo& m_commandFifo;
	const ApuOutputRing& m_outputRing;
};

} // namespace bmsx
