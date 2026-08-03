#pragma once

#include "machine/cpu/cpu.h"
#include "machine/runtime/frame/state.h"

#include <cstdint>

namespace bmsx {

class Runtime;

constexpr int MAX_CPU_SLICE_CYCLES = 0x7fffffff;

enum class CpuExecutionResult {
	Halted,
	Yielded,
	ExecutionStopped,
};

enum class CpuSuspendedRunResult {
	Completed,
	Halted,
	ExecutionStopped,
};

class CpuExecutionState {
public:
	void reset();
	bool runStoppedCpu(Runtime& runtime, FrameState& frameState);
	CpuExecutionResult runWithBudget(Runtime& runtime, FrameState& frameState);
	InstructionStepResult runInstruction(Runtime& runtime, FrameState& frameState);
	CpuSuspendedRunResult runSuspendedUntilDepth(Runtime& runtime, int targetDepth);

private:
	enum class CpuSliceResult : uint8_t {
		Blocked,
		Advanced,
		InstructionYielded,
		InstructionHalted,
		ExecutionStopped,
		Halted,
	};

	CpuSliceResult runSlice(
		Runtime& runtime,
		FrameState& frameState,
		int maximumCpuCycles
	);
	i64 m_sliceCycleBudgetRemaining = 0;
	bool m_instructionRunActive = false;
};

bool advanceRuntimeTime(Runtime& runtime, int cycles);
bool runDueRuntimeTimers(Runtime& runtime);

} // namespace bmsx
