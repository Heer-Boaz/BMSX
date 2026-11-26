#pragma once
#include "machine/cpu/lua_heap.h"

namespace bmsx {
enum class TableStoreReturn : u32 { None, Call, Protected };
enum class TableCensus : u32 { None, General, Scheduled, RetryCurrent, RetryFresh };
struct ArrayDensity {
	u32 cursor = 0, live = 0, slots = 0, kept = 0;
	bool operator==(const ArrayDensity&) const = default;
};
// A store first counts tags if needed, then owns any replacement storage until publication.
struct TableRebuild {
	u32 record = 0, source = 0, count = 0, storage = 0, capacity = 0;
	u32 arrayStorage = 0, arraySlots = 0, arrayCleared = 0;
	u32 cleared = 0, homes = 0, cursor = 0, free = 0, collisions = 0;
	Value key = valueNil(), value = valueNil();
	TableStoreReturn result = TableStoreReturn::None;
	u32 destination = 0, wanted = 0, instructionPc = 0;
	TableCensus census = TableCensus::None;
	LuaAllocationRecovery recovery = LuaAllocationRecovery::CurrentOrFresh;
	ArrayDensity density{};
	bool operator==(const TableRebuild&) const = default;
};
} // namespace bmsx
