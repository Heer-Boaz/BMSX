#pragma once

#include <array>

#include "common/primitives.h"
#include "machine/cpu/value.h"

namespace bmsx {
enum class TableLookupStatus : u32 { Resolved, ChainExhausted, Invoke, Forward, Store };

// Transient semantic result, not a guest allocation or a predicted-probe counter.
struct TableLookupResult {
	Value value;
	i32 slot;
	u32 extraVisits;
	TableLookupStatus status;
	u32 receiver = 0;
};

// Inherited path hints belong to the generated callsite, not the decoded
// receiver slot. Probe the live table at every hop; never cache a value.
struct TableStringPathCache {
	i32 holderSlot;
	u32 holderDepth;
	std::array<i32, 3> indexSlots;
};

// Transient ABI for a bounded read-only path after the receiver prediction misses.
struct TableSingleIndexProbe {
	Value result;
	u32 receiver;
	StringId key, indexKey;
};

} // namespace bmsx
