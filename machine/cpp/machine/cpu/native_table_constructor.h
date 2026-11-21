#pragma once

#include <array>

#include "machine/cpu/string_pool.h"
#include "machine/cpu/table_constructor_layout.h"
#include "spec/bmsx/cartridge.h"

namespace bmsx {

// A compiled fixed-key construction recipe. CPU execution owns the dynamic
// layout cache and publication binds the continuation cells.
struct NativeTableConstructor {
	const TableConstructorLayout& layoutFor(u32 present);

	std::array<StringId, TABLE_RECORD_FIELDS_MAX> keys{};
	std::array<i16, TABLE_RECORD_FIELDS_MAX> operands{};
	u32 count = 0;
	u32 requiredSlots = 0;
	u32 nextPc = 0;
	u32 lastInstructionPc = 0;
	u32 lastWordPc = 0;
	std::array<void* const*, CARTRIDGE_SLOT_COUNT> continuation{};
	TableConstructorLayout full;
	TableConstructorLayout partial;
	u32 partialMask = 0;
};

} // namespace bmsx
