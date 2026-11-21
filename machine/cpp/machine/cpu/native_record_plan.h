#pragma once

#include <array>

#include "machine/cpu/string_pool.h"
#include "machine/cpu/table_constructor_layout.h"

namespace bmsx {

using NativeRecordId = u16;

// Immutable fixed-key allocation plan. Each original field still has an
// independent entry, and shorter grants can execute the original stores.
struct NativeRecordPlan {
	std::array<StringId, TABLE_RECORD_FIELDS_MAX> keys{};
	std::array<i16, TABLE_RECORD_FIELDS_MAX> operands{};
	u32 count = 0;
	u32 requiredSlots = 0;
	u32 nextPc = 0;
	u32 lastInstructionPc = 0;
	u32 lastWordPc = 0;
	TableConstructorLayout full;
};

} // namespace bmsx
