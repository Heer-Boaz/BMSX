#pragma once

#include <array>

#include "common/primitives.h"
#include "machine/cpu/value.h"

namespace bmsx {
enum class TableLookupStatus : u32 { Resolved, ChainExhausted, NilKey };

// Transient semantic result, not a guest allocation or a predicted-probe counter.
struct TableLookupResult {
	Value value;
	i32 slot;
	u32 extraVisits;
	TableLookupStatus status;
};

struct TableReadRequest {
	u32 address, keyWord;
	StringId indexKey;
	u32 keyTag;
};

// Native callsite metadata. Slots are hints on the table reached during the
// current lookup, never addresses or copies of values. The most recent
// inherited hit names the holder by depth; only the first hops need storage.
struct TableStringReadCache {
	i32 receiverSlot;
	i32 holderSlot;
	u32 holderDepth;
	std::array<i32, 3> indexSlots;
};

} // namespace bmsx
