#pragma once

#include "common/types.h"
#include "machine/cpu/cpu.h"

namespace bmsx {

class InputControllerInputSource;
class InputControllerRegisterFile;
class Memory;

class InputControllerOutputPort {
public:
	InputControllerOutputPort(InputControllerInputSource& input, const InputControllerRegisterFile& registers, Memory& memory);

	static void writeOutputControlRegisterThunk(void* context, u32 addr, Value value);

	void writeOutputControlRegister(u32 addr, Value value);

private:
	InputControllerInputSource& m_input;
	const InputControllerRegisterFile& m_registers;
	Memory& m_memory;
};

} // namespace bmsx
