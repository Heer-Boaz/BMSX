#pragma once

#include "machine/cpu/cpu.h"
#include "spec/bmsx/rom_header.h"

namespace bmsx::test {

// Carry unused cycles across BIOS grants, without treating a firmware yield
// as completion or returning its unused time as fresh guest cycles.
inline RunResult runCpuWithinBudget(CPU& cpu, int budget, int depth = 0, int* fullGcCycles = nullptr) {
	auto result = RunResult::Yielded;
	auto& memory = cpu.memory();
	const u32 descriptor = fullGcCycles
		? memory.readMappedU32LE(memory.readMappedU32LE(BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET) + HEAP_SERVICE_IMAGE_ADDRESS_OFFSET)
		: 0u;
	const u32 collector = fullGcCycles ? memory.readMappedU32LE(descriptor + HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET
		+ 4u * static_cast<u32>(HeapServiceOperation::FullCollection)) : 0u;
	const u32 functionLane = cpu.heapAllocator().managementOffset() + HEAP_SERVICE_FRAME_OFFSET + static_cast<u32>(FrameField::Function);
	for (int slices = 0; slices < 16384 && result == RunResult::Yielded && budget > 0; ++slices) {
		const bool fullGcGrant = fullGcCycles && cpu.heapServiceActive() && memory.readRamRecordWord(functionLane) == collector;
		result = cpu.runUntilDepth(depth, budget);
		if (fullGcGrant) *fullGcCycles += budget - cpu.instructionBudgetRemaining;
		budget = cpu.instructionBudgetRemaining;
	}
	return result;
}

} // namespace bmsx::test
