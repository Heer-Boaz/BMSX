#pragma once

#include "machine/memory/memory.h"

#include <cstdint>

namespace bmsx {

class IrqController {
public:
	explicit IrqController(Memory& memory);

	void reset();
	void postLoad();
	uint32_t pendingFlags() const;
	void raise(uint32_t mask);
	void acknowledge(uint32_t mask);
	uint64_t signalSequence() const { return m_signalSequence; }

private:
	static void onAckWriteThunk(void* context, uint32_t addr, Value value);
	void onAckWrite();

	Memory& m_memory;
	uint64_t m_signalSequence = 0;
};

} // namespace bmsx
