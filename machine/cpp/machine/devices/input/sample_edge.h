#pragma once

#include "common/types.h"
#include "machine/devices/input/contracts.h"

namespace bmsx {

class InputControllerRegisterFile;
class InputControllerSampleLatch;
class Memory;

class InputControllerSampleEdge final {
public:
	InputControllerSampleEdge(InputControllerInputSource& input, InputControllerSampleLatch& sampleLatch, InputControllerRegisterFile& registers, Memory& memory);

	void onVblankEdge(f64 currentTimeMs, u32 nowCycles);

private:
	InputControllerInputSource& m_input;
	InputControllerSampleLatch& m_sampleLatch;
	InputControllerRegisterFile& m_registers;
	Memory& m_memory;
	InputControllerSnapshot m_snapshot;
};

} // namespace bmsx
