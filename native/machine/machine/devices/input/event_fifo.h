#pragma once

#include "machine/cpu/cpu.h"
#include "machine/devices/input/contracts.h"

#include <array>
#include <vector>

namespace bmsx {

class Memory;

struct InputControllerEventState {
	u32 player = 0;
	StringId actionStringId = 0;
	u32 statusWord = 0;
	u32 valueQ16 = 0;
	u32 repeatCount = 0;
};

class InputControllerEventFifo {
public:
	explicit InputControllerEventFifo(Memory& memory);

	static Value readRegisterThunk(void* context, u32 addr);
	static void writeEventControlRegisterThunk(void* context, u32 addr, Value value);

	u32 count() const;
	bool overflow() const;
	u32 statusWord() const;
	const InputControllerEventState& front() const;
	Value readRegister(u32 addr) const;
	void writeControl(u32 command);
	void writeEventControlRegister(Value value);
	void push(u32 player, StringId actionStringId, u32 statusWord, u32 valueQ16, u32 repeatCount);
	void pop();
	void clear();
	std::vector<InputControllerEventState> captureEvents() const;
	void restore(const std::vector<InputControllerEventState>& events, bool overflow);

private:
	Memory& m_memory;
	std::array<InputControllerEventState, INPUT_CONTROLLER_EVENT_FIFO_CAPACITY> m_slots{};
	u32 m_readIndex = 0;
	u32 m_writeIndex = 0;
	u32 m_queuedCount = 0;
	bool m_overflowLatched = false;
};

} // namespace bmsx
