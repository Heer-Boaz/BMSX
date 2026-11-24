#pragma once

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

} // namespace bmsx
