#pragma once

#include <chrono>
#include <cstring>
#include <stdexcept>
#include <thread>

#include "machine/cpu/cpu.h"
#include "machine/cpu/execution_image.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx::test {

// The preceding warm grant must have returned Yielded with no positive budget.
// A zero-instruction grant lets the CPU owner publish its pending worker result
// without changing the guest PC, registers, bus effects or remaining budget.
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#if defined(BMSX_NATIVE_COMPILER_WORKER)
// These fixtures enable profiling before running decoded, supported, fault-free
// code: each preparation request in them submits one worker job. prepareRequests
// is generally a preparation-attempt counter, not a universal submission counter.
// Publish their outstanding jobs without executing another guest instruction.
inline void waitForFixtureWorkerRequests(CPU& cpu) {
	if (cpu.instructionBudgetRemaining > 0) throw std::runtime_error("native publication requires an exhausted warm grant");
	const auto submitted = cpu.readNativeCompilationProfile().prepareRequests;
	const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
	while (cpu.readNativeCompilationProfile().backgroundCompleted < submitted) {
		if (cpu.runUntilDepth(0, cpu.instructionBudgetRemaining) != RunResult::Yielded)
			throw std::runtime_error("native publication requires a runnable exhausted CPU");
		if (std::chrono::steady_clock::now() >= deadline) throw std::runtime_error("submitted native compilation was not published");
		std::this_thread::yield();
	}
}
#endif
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

inline bool sameLanguageRam(CPU& left, CPU& right) {
	const u32 floor = left.heapAllocator().floorAddress();
	if (floor != right.heapAllocator().floorAddress()) return false;
	const size_t offset = floor - RAM_BASE;
	return std::memcmp(left.memory().ramData() + offset, right.memory().ramData() + offset,
		left.memory().ramByteCount() - offset) == 0;
}

inline u32 allocatedObjectRecords(CPU& cpu) {
	struct Counter { Memory& memory; u32 count = 0; } records{cpu.memory()};
	cpu.heapAllocator().visitObjectRecords(&records, [](void* context, u32 address) -> i32 {
		auto& records = *static_cast<Counter*>(context);
		switch (records.memory.readRamRecordByte(address)) {
			case static_cast<u8>(ValueTag::Table):
			case static_cast<u8>(ValueTag::Closure):
			case THREAD_RECORD_KIND:
			case UPVALUE_RECORD_KIND:
				++records.count;
				break;
		}
		return 1;
	});
	return records.count;
}

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
