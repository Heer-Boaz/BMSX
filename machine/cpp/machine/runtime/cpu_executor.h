#pragma once

#include "machine/cpu/cpu.h"
#include "machine/runtime/frame/state.h"

#include <cstdint>

namespace bmsx {

class Runtime;

constexpr int MAX_CPU_SLICE_CYCLES = 0x7fffffff;

class CpuExecutionState {
public:
	bool runStoppedCpu(Runtime& runtime, FrameState& frameState);
	RunResult runWithBudget(Runtime& runtime, FrameState& frameState);
};

bool advanceRuntimeTime(Runtime& runtime, int cycles);
bool runDueRuntimeTimers(Runtime& runtime);

} // namespace bmsx
