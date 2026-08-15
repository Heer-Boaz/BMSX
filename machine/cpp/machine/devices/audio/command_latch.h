#pragma once

#include "common/primitives.h"
#include "machine/devices/audio/contracts.h"
#include "machine/memory/bus_signals.h"

namespace bmsx {

class ApuSelectedSlotLatch;
class Memory;

class ApuCommandLatch final {
public:
	ApuCommandLatch(Memory& memory, ApuSelectedSlotLatch& selectedSlotLatch);

	void clear();
	void restore(const ApuParameterRegisterWords& registerWords);
	[[nodiscard]] auto registerWords() const -> const ApuParameterRegisterWords& { return m_registerWords; }

private:
	static void parameterWriteThunk(void* context, u32 addr, u32 value, MappedBusSignals busSignals);
	void mirrorRegisters();

	Memory& m_memory;
	ApuSelectedSlotLatch& m_selectedSlotLatch;
	ApuParameterRegisterWords m_registerWords{};
};

} // namespace bmsx
