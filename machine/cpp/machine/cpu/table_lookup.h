#pragma once

#include <array>

#include "common/primitives.h"
#include "machine/cpu/value.h"

namespace bmsx {
enum class TableLookupStatus : u32 { Resolved, ChainExhausted, Invoke, Forward, Store };
inline constexpr i32 TABLE_HASH_UNPROBED = -2;

// Transient semantic result, not a guest allocation or a predicted-probe counter.
struct TableLookupResult {
	Value value;
	// For a String Store: unprobed, -1 for absent, or a matched hash node
	// (including a tombstone) in receiver. Consume before running guest code.
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

} // namespace bmsx
