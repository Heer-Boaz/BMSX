#include "machine/devices/audio/command_fifo.h"

#include "machine/bus/io.h"
#include "machine/memory/memory.h"

namespace bmsx {

u32 ApuCommandFifo::count() const {
	return m_queuedCount;
}

u32 ApuCommandFifo::free() const {
	return APU_COMMAND_FIFO_CAPACITY - m_queuedCount;
}

u32 ApuCommandFifo::capacity() const {
	return APU_COMMAND_FIFO_CAPACITY;
}

bool ApuCommandFifo::empty() const {
	return m_queuedCount == 0u;
}

bool ApuCommandFifo::full() const {
	return m_queuedCount == APU_COMMAND_FIFO_CAPACITY;
}

void ApuCommandFifo::reset() {
	m_commands.fill(APU_CMD_NONE);
	m_registerWords.fill(0u);
	m_readIndex = 0u;
	m_writeIndex = 0u;
	m_queuedCount = 0u;
}

bool ApuCommandFifo::enqueue(u32 command, const Memory& memory) {
	if (full()) {
		return false;
	}
	const u32 entry = m_writeIndex;
	m_commands[entry] = command;
	const size_t base = static_cast<size_t>(entry) * APU_PARAMETER_REGISTER_COUNT;
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		m_registerWords[base + index] = memory.readIoU32(IO_APU_PARAMETER_REGISTER_ADDRS[index]);
	}
	m_writeIndex += 1u;
	if (m_writeIndex == APU_COMMAND_FIFO_CAPACITY) {
		m_writeIndex = 0u;
	}
	m_queuedCount += 1u;
	return true;
}

u32 ApuCommandFifo::popInto(ApuParameterRegisterWords& target) {
	const u32 entry = m_readIndex;
	const u32 command = m_commands[entry];
	const size_t base = static_cast<size_t>(entry) * APU_PARAMETER_REGISTER_COUNT;
	for (size_t index = 0; index < APU_PARAMETER_REGISTER_COUNT; index += 1u) {
		target[index] = m_registerWords[base + index];
		m_registerWords[base + index] = 0u;
	}
	m_commands[entry] = APU_CMD_NONE;
	m_readIndex += 1u;
	if (m_readIndex == APU_COMMAND_FIFO_CAPACITY) {
		m_readIndex = 0u;
	}
	m_queuedCount -= 1u;
	return command;
}

ApuCommandFifoState ApuCommandFifo::captureState() const {
	ApuCommandFifoState state;
	state.commands = m_commands;
	state.registerWords = m_registerWords;
	state.readIndex = m_readIndex;
	state.writeIndex = m_writeIndex;
	state.count = m_queuedCount;
	return state;
}

void ApuCommandFifo::restoreState(const ApuCommandFifoState& state) {
	m_commands = state.commands;
	m_registerWords = state.registerWords;
	m_readIndex = state.readIndex;
	m_writeIndex = state.writeIndex;
	m_queuedCount = state.count;
}

} // namespace bmsx
