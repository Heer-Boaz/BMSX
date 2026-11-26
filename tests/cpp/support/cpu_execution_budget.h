#pragma once

#include "machine/cpu/cpu.h"

namespace bmsx::test {

// Carry unused cycles across BIOS grants, without treating a firmware yield
// as completion or returning its unused time as fresh guest cycles.
inline RunResult runCpuWithinBudget(CPU& cpu, int budget, int depth = 0, int* fullGcCycles = nullptr) {
	auto result = RunResult::Yielded;
	for (int slices = 0; slices < 16384 && result == RunResult::Yielded && budget > 0; ++slices) {
		const bool fullGcGrant = fullGcCycles && cpu.gcHeap().fullEpochs() != 0;
		result = cpu.runUntilDepth(depth, budget);
		if (fullGcGrant) *fullGcCycles += budget - cpu.instructionBudgetRemaining;
		budget = cpu.instructionBudgetRemaining;
	}
	return result;
}

} // namespace bmsx::test
