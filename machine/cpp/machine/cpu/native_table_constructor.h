#pragma once

#include <array>

#include "machine/cpu/native_record_plan.h"
#include "machine/cpu/value_slots.h"
#include "spec/bmsx/cartridge.h"

namespace bmsx {

// A compiled fixed-key construction recipe. CPU execution owns the dynamic
// layout cache and publication binds the continuation cells.
struct NativeTableConstructor : NativeRecordPlan {
	explicit NativeTableConstructor(const NativeRecordPlan& plan) : NativeRecordPlan(plan) {}
	bool bindKeys(ConstValueSpan constants);
	const TableConstructorLayout& layoutFor(u32 present);

	std::array<void* const*, CARTRIDGE_SLOT_COUNT> continuation{};
	std::array<StringId, TABLE_RECORD_FIELDS_MAX> keys{};
	TableConstructorLayout full;
	TableConstructorLayout partial;
	u32 partialMask = 0;
	bool keysBound = false;
};

} // namespace bmsx
