#pragma once

#include "machine/devices/irq/save_state.h"
#include "machine/memory/bus_master.h"
#include "machine/memory/memory.h"

#include <cstdint>

namespace bmsx {

class IrqController {
public:
	explicit IrqController(Memory& memory);

	void reset();
	void postLoad();
	IrqControllerState captureState() const;
	void restoreState(const IrqControllerState& state);
	bool hasAssertedMaskableInterruptLine() const { return (m_pendingFlags & m_mask) != 0u; }
	void raise(uint32_t mask);
	void acknowledge(uint32_t mask);

private:
	static Value onFlagsReadThunk(void* context, uint32_t addr, MappedBusMaster busMaster);
	static void onAckWriteThunk(void* context, uint32_t addr, Value value, MappedBusMaster busMaster);
	static Value onMaskReadThunk(void* context, uint32_t addr, MappedBusMaster busMaster);
	static void onMaskWriteThunk(void* context, uint32_t addr, Value value, MappedBusMaster busMaster);

	Memory& m_memory;
	uint32_t m_pendingFlags = 0;
	uint32_t m_mask = 0;
};

} // namespace bmsx
