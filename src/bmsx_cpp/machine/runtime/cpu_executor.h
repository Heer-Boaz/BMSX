#pragma once

#include "machine/cpu/cpu.h"
#include "machine/runtime/frame/state.h"

#include <cstdint>

namespace bmsx {

class Runtime;

class CpuExecutionState {
public:
	void clearHaltUntilIrq(Runtime& runtime);
	bool runHaltedUntilIrq(Runtime& runtime, FrameState& frameState);
	RunResult runWithBudget(Runtime& runtime, FrameState& frameState);
};

void advanceRuntimeTime(Runtime& runtime, int cycles);
void runDueRuntimeTimers(Runtime& runtime);

} // namespace bmsx
