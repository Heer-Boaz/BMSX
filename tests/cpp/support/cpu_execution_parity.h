#pragma once

#include <chrono>
#include <stdexcept>
#include <thread>

#include "machine/cpu/cpu.h"
#include "machine/cpu/execution_image.h"

namespace bmsx::test {

// The preceding warm grant must have returned Yielded with no positive budget.
// A zero-instruction grant lets the CPU owner publish its pending worker result
// without changing the guest PC, registers, bus effects or remaining budget.
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
inline void waitForNativeEntry(CPU& cpu, const DecodedInstructionPage& page, u32 word) {
	if (cpu.instructionBudgetRemaining > 0) throw std::runtime_error("native publication requires an exhausted warm grant");
	const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
	while (!page.nativeBlocks || !page.nativeBlocks->entries[word]) {
		if (cpu.runUntilDepth(0, cpu.instructionBudgetRemaining) != RunResult::Yielded)
			throw std::runtime_error("native publication requires a runnable exhausted CPU");
		if (std::chrono::steady_clock::now() >= deadline) throw std::runtime_error("requested native entry was not published");
		std::this_thread::yield();
	}
}
#endif

// Both routes receive the same grant; compare their actual consumed cycles.
inline RunResult runCpuParity(CPU& generated, CPU& reference, int grant, int depth = 0) {
	const auto result = generated.runUntilDepth(depth, grant);
	const int consumed = grant - generated.instructionBudgetRemaining;
	if (reference.runUntilDepth(depth, grant) != result
		|| grant - reference.instructionBudgetRemaining != consumed) {
		throw std::runtime_error("generated and scalar execution differ at the same guest-cycle boundary");
	}
	return result;
}

} // namespace bmsx::test
