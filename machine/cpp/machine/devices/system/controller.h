#pragma once

#include "machine/memory/memory.h"

namespace bmsx {

struct SystemControllerState {
	bool resetRequested = false;
};

class SystemController {
public:
	SystemController(Memory& memory, CPU& cpu);
	void reset();
	bool takeResetRequest();
	SystemControllerState captureState() const;
	void restoreState(const SystemControllerState& state);

private:
	void writeControl(u32 address, Value value);

	Memory& m_memory;
	CPU& m_cpu;
	bool m_resetRequested = false;
};

} // namespace bmsx
