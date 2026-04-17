#pragma once

#include "machine/cpu/cpu.h"
#include "machine/runtime/frame_state.h"

namespace bmsx {

class Runtime;

class CpuExecutionState {
public:
	RunResult runWithBudget(Runtime& runtime, FrameState& frameState);
};

void advanceRuntimeTime(Runtime& runtime, int cycles);
void runDueRuntimeTimers(Runtime& runtime);

} // namespace bmsx
