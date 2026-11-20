#pragma once

#include <array>
#include <memory>
#include <span>

#include "machine/cpu/table_constructor_layout.h"
#include "machine/cpu/value_slots.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {

struct NativeBlockExitSite;
struct DecodedInstructionPage;

// The decoded ROM recipe owns no guest objects. The all-present layout is
// immutable; the CPU thread remembers the most recent other presence mask.
struct NativeTableConstructor {
	static std::unique_ptr<NativeTableConstructor> prepare(const NativeBlockExitSite& exit,
		const DecodedInstructionPage& page, u32 pagePc, ConstValueSpan constants);
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
