#pragma once

#include "common/primitives.h"

#include <cstdint>

namespace bmsx {

enum class InstructionStepResult : uint8_t {
	Blocked,
	Advanced,
	Executed,
};

struct FrameState {
	bool updateExecuted = false;
	bool luaFaulted = false;
	i64 cycleBudgetRemaining = 0;
	i64 cycleBudgetGranted = 0;
	i64 cycleCarryGranted = 0;
	i64 activeCpuUsedCycles = 0;
};

} // namespace bmsx
