#pragma once

#include "common/types.h"
#include "machine/cpu/cpu.h"

namespace bmsx {

class Input;
class InputControllerRegisterFile;
class Memory;

class InputControllerOutputPort {
public:
	InputControllerOutputPort(Input& input, const InputControllerRegisterFile& registers, Memory& memory);

	static Value readRegisterThunk(void* context, u32 addr);
	static void writeOutputControlRegisterThunk(void* context, u32 addr, Value value);

	u32 readStatus(u32 player) const;
	Value readRegister(u32 addr) const;
	void writeControl(u32 command);
	void writeOutputControlRegister(Value value);
	void apply(u32 player, u32 intensityQ16, u32 durationMs);

private:
	Input& m_input;
	const InputControllerRegisterFile& m_registers;
	Memory& m_memory;
};

} // namespace bmsx
