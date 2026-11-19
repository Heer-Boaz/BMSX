#pragma once

#include "common/primitives.h"
#include "spec/blua32/memory_access_kind.h"

namespace bmsx {

enum class PendingMemoryKind : u32 { None, Store, WordStores };

// The decoded instruction stays latched while an endpoint is not ready.
struct PendingMemoryOperation {
	PendingMemoryKind kind = PendingMemoryKind::None;
	u32 instructionPc = 0;
	u32 nextPc = 0;
	u32 address = 0;
	MemoryAccessKind accessKind = MemoryAccessKind::Word;
	int registerIndex = 0;
	int wordCount = 0;
	bool operator==(const PendingMemoryOperation&) const = default;
};

} // namespace bmsx
