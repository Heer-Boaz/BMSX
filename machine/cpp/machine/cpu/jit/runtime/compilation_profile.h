#pragma once

#include "common/primitives.h"

namespace bmsx {

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
	// Total preparation includes image discovery; the maximum is one source request.
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
