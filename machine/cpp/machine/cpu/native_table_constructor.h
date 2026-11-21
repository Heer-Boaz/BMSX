#pragma once

#include <array>

#include "machine/cpu/native_record_plan.h"
#include "spec/bmsx/cartridge.h"

namespace bmsx {

// A compiled fixed-key construction recipe. CPU execution owns the dynamic
// layout cache and publication binds the continuation cells.
struct NativeTableConstructor : NativeRecordPlan {
	explicit NativeTableConstructor(const NativeRecordPlan& plan) : NativeRecordPlan(plan) {}
	const TableConstructorLayout& layoutFor(u32 present);

	std::array<void* const*, CARTRIDGE_SLOT_COUNT> continuation{};
	TableConstructorLayout partial;
	u32 partialMask = 0;
};

} // namespace bmsx
