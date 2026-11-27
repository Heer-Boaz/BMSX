#pragma once

#include "machine/cpu/cpu.h"

namespace bmsx::test {

// Carry unused cycles across BIOS grants, without treating a firmware yield
// as completion or returning its unused time as fresh guest cycles.
inline RunResult runCpuWithinBudget(CPU& cpu, int budget, int depth = 0, int* fullGcCycles = nullptr, u32 collector = 0u) {
	auto result = RunResult::Yielded;
	auto& memory = cpu.memory();
	const u32 functionLane = cpu.heapAllocator().managementOffset() + HEAP_SERVICE_FRAME_OFFSET + static_cast<u32>(FrameField::Function);
	for (int slices = 0; slices < 32768 && result == RunResult::Yielded && budget > 0; ++slices) {
		const bool fullGcGrant = fullGcCycles && cpu.heapServiceActive() && memory.readRamRecordWord(functionLane) == collector;
		result = cpu.runUntilDepth(depth, budget);
		if (fullGcGrant) *fullGcCycles += budget - cpu.instructionBudgetRemaining;
		budget = cpu.instructionBudgetRemaining;
	}
	return result;
}

} // namespace bmsx::test
