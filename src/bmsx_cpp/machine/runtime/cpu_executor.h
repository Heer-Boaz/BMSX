#pragma once

#include "machine/cpu/cpu.h"
#include "machine/runtime/frame/state.h"

#include <cstdint>

namespace bmsx {

class Runtime;

class CpuExecutionState {
public:
	bool runHaltedUntilIrq(Runtime& runtime, FrameState& frameState);
	RunResult runWithBudget(Runtime& runtime, FrameState& frameState);
};

bool advanceRuntimeTime(Runtime& runtime, int cycles);
bool runDueRuntimeTimers(Runtime& runtime);

} // namespace bmsx
