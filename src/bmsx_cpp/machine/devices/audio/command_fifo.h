#pragma once

#include "common/types.h"
#include "machine/devices/audio/contracts.h"

#include <array>

namespace bmsx {

class Memory;

struct ApuCommandFifoState {
	std::array<u32, APU_COMMAND_FIFO_CAPACITY> commands{};
	std::array<u32, APU_COMMAND_FIFO_REGISTER_WORD_COUNT> registerWords{};
	u32 readIndex = 0;
	u32 writeIndex = 0;
	u32 count = 0;
};

class ApuCommandFifo {
public:
	u32 count() const;
	u32 free() const;
	bool empty() const;
	bool full() const;
	void reset();
	bool enqueue(u32 command, const Memory& memory);
	u32 popInto(ApuParameterRegisterWords& target);
	ApuCommandFifoState captureState() const;
	void restoreState(const ApuCommandFifoState& state);

private:
	std::array<u32, APU_COMMAND_FIFO_CAPACITY> m_commands{};
	std::array<u32, APU_COMMAND_FIFO_REGISTER_WORD_COUNT> m_registerWords{};
	u32 m_readIndex = 0;
	u32 m_writeIndex = 0;
	u32 m_queuedCount = 0;
};

} // namespace bmsx
