#pragma once

#include "machine/memory/memory.h"
#include "machine/devices/irq/save_state.h"

#include <cstdint>

namespace bmsx {

class IrqController {
public:
	explicit IrqController(Memory& memory);

	void reset();
	void postLoad();
	IrqControllerState captureState() const;
	void restoreState(const IrqControllerState& state);
	bool hasAssertedMaskableInterruptLine() const { return m_pendingFlags != 0u; }
	void raise(uint32_t mask);
	void acknowledge(uint32_t mask);

private:
	static Value onFlagsReadThunk(void* context, uint32_t addr);
	static void onAckWriteThunk(void* context, uint32_t addr, Value value);

	Memory& m_memory;
	uint32_t m_pendingFlags = 0;
};

} // namespace bmsx
