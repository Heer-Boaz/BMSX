#pragma once
#include "machine/cpu/value.h"

namespace bmsx {
// In-flight hash replacement. Both backing allocations remain owned until retirement.
enum class TableStoreReturn : u32 { None, Call, Protected };
struct TableRebuild {
	u32 record = 0, source = 0, count = 0, storage = 0, capacity = 0;
	u32 arrayStorage = 0, arraySlots = 0, arrayCleared = 0;
	u32 cleared = 0, homes = 0, cursor = 0, free = 0, collisions = 0;
	Value key = valueNil(), value = valueNil();
	TableStoreReturn result = TableStoreReturn::None;
	u32 destination = 0, wanted = 0, instructionPc = 0;
	bool operator==(const TableRebuild&) const = default;
};
} // namespace bmsx
