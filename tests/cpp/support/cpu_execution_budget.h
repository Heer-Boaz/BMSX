#pragma once

#include "machine/cpu/cpu.h"

namespace bmsx::test {

// Carry unused cycles across BIOS grants, without treating a firmware yield
// as completion or returning its unused time as fresh guest cycles.
inline RunResult runCpuWithinBudget(CPU& cpu, int budget, int depth = 0) {
	auto result = RunResult::Yielded;
	for (int slices = 0; slices < 32768 && result == RunResult::Yielded && budget > 0; ++slices) {
		result = cpu.runUntilDepth(depth, budget);
		budget = cpu.instructionBudgetRemaining;
	}
	return result;
}

} // namespace bmsx::test
