#pragma once

#include <array>

#include "common/primitives.h"

namespace bmsx {

// Static code-generation transport emissions, not executed instructions or
// estimated work. A loop body is counted once. Shared-gate instructions are
// not emitted per region and are deliberately absent from these counters.
enum class NativeLoweringPhase : u8 { Body, Entry, Edge, Frontier, Count };

struct NativeLoweringCounts {
	u64 registerValueLoads = 0;
	u64 registerHeaderLoads = 0;
	u64 registerPayloadLoads = 0;
	u64 constantValueLoads = 0;
	u64 indirectValueLoads = 0;
	u64 rawFprCopies = 0;
	u64 rawRematerializations = 0;
	u64 headerExtractions = 0;
	u64 payloadExtractions = 0;
	u64 dirtyEvictionStores = 0;
	u64 publicationStores = 0;
	u64 helperArgumentStores = 0;
	u64 helperResultLoads = 0;
	u64 helperSpillStores = 0;
	u64 helperSpillReloads = 0;
	u64 rangeValueLoads = 0;
	u64 rangeValueStores = 0;
};

struct NativeLoweringStats {
	std::array<NativeLoweringCounts, static_cast<size_t>(NativeLoweringPhase::Count)> phases{};
};

// Host-only cumulative measurements for one CPU lifetime. Reset/restore do not
// rewind these counters. codeBytes is filled from the executable owner's live
// accounting when read; it is not a second cache-size counter.
struct NativeCompilationProfile {
	u64 prepareRequests = 0;
	u64 regionsPublished = 0;
	u64 entriesPublished = 0;
	u64 sourceInstructions = 0;
	u64 emittedCodeBytes = 0;
	u64 codeBytes = 0;
	u64 peakCodeBytes = 0;
	u64 prepareNanoseconds = 0;
	u64 maxPrepareNanoseconds = 0;
	u64 discoveryNanoseconds = 0;
	u64 retirementNanoseconds = 0;
	u64 compilationNanoseconds = 0;
	u64 mergedRegions = 0;
	u64 mergedCodeBytes = 0;
	u64 capacityFlushes = 0;
	u64 capacityRetiredCodeBytes = 0;
	// Parallel emission is not CPU-thread preparation time. Keep it separate
	// rather than adding overlapping worker time to frame-blocking costs.
	u64 backgroundCompleted = 0;
	u64 backgroundCancelled = 0;
	u64 backgroundNanoseconds = 0;
	i32 maxPrepareDomain = 0;
	u32 maxPrepareCartridgeSlot = 0;
	u32 maxPrepareRootPc = 0;
	u32 maxPreparePagePc = 0;
};

} // namespace bmsx
