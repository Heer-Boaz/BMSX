#pragma once

#include "machine/cpu/cpu.h"

namespace bmsx {

class InputControllerRegisterFile;
class InputControllerSampleLatch;
class Memory;

class InputControllerControlPort {
public:
	InputControllerControlPort(Memory& memory, InputControllerRegisterFile& registers, InputControllerSampleLatch& sampleLatch);

	static void writeControlThunk(void* context, u32 addr, Value value);

	void writeControl(Value value);

private:
	Memory& m_memory;
	InputControllerRegisterFile& m_registers;
	InputControllerSampleLatch& m_sampleLatch;
};

} // namespace bmsx
