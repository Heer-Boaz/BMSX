#pragma once

#include "machine/devices/irq/save_state.h"
#include "machine/memory/bus_signals.h"
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
	void raiseUser(uint32_t mask);
	void acknowledge(uint32_t mask);
	void enterSupervisorContext();
	void enterSupervisorFaultContext();
	void leaveSupervisorContext();

private:
	static Value onFlagsReadThunk(void* context, uint32_t addr, MappedBusSignals busSignals);
	static void onAckWriteThunk(void* context, uint32_t addr, Value value, MappedBusSignals busSignals);
	static Value onMaskReadThunk(void* context, uint32_t addr, MappedBusSignals busSignals);
	static void onMaskWriteThunk(void* context, uint32_t addr, Value value, MappedBusSignals busSignals);

	Memory& m_memory;
	uint32_t m_pendingFlags = 0;
	uint32_t m_mask = 0;
	uint32_t m_userPendingFlags = 0;
	uint32_t m_userMask = 0;
	bool m_supervisorContextActive = false;
};

} // namespace bmsx
