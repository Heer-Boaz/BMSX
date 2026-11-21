#include "machine/cpu/native_table_constructor.h"

#include <algorithm>
#include "machine/cpu/execution_image.h"
#include "machine/cpu/table.h"

namespace bmsx {

std::unique_ptr<NativeTableConstructor> NativeTableConstructor::prepare(const NativeBlockExitSite& exit,
	const DecodedInstructionPage& page, u32 pagePc, ConstValueSpan constants) {
	const auto& allocation = exit.operands.allocation;
	const auto count = static_cast<u32>(allocation.hashSize);
	if (allocation.arraySize != 0 || count < 2 || count > TABLE_RECORD_FIELDS_MAX) return nullptr;
	NativeTableConstructor plan;
	plan.count = count;
	plan.requiredSlots = static_cast<u32>(allocation.result) + 1u;
	u32 pc = exit.nextPc;
	for (u32 field = 0; field < count; ++field) {
		const u32 word = (pc - pagePc) / INSTRUCTION_BYTES;
		if (word >= DECODED_PAGE_WORDS || (page.refreshState[word] & DECODED_REFRESH_DECODE) != 0u) return nullptr;
		const auto& instruction = page.words[word];
		// SETFIELD keeps its normal entry even when reached independently;
		// only the preceding NEWT owns this construction recipe.
		if (instruction.op != static_cast<u8>(OpCode::SETFIELD)
			|| instruction.dispatchOp == static_cast<u8>(DecodedDispatchOp::Observe) || instruction.a != allocation.result
			|| instruction.c == allocation.result || static_cast<size_t>(instruction.b) >= constants.size()
			|| constants.tag(instruction.b) != ValueTag::String) return nullptr;
		const StringId key = constants.payload(instruction.b);
		const auto end = plan.keys.begin() + field;
		if (std::find(plan.keys.begin(), end, key) != end) return nullptr;
		plan.keys[field] = key;
		plan.operands[field] = instruction.c;
		if (instruction.c >= 0)
			plan.requiredSlots = std::max(plan.requiredSlots, static_cast<u32>(instruction.c) + 1u);
		else if (static_cast<size_t>(-1 - instruction.c) >= constants.size()) return nullptr;
		plan.lastInstructionPc = pc;
		pc += static_cast<u32>(instruction.width) * INSTRUCTION_BYTES;
		plan.lastWordPc = pc - INSTRUCTION_BYTES;
	}
	plan.nextPc = pc;
	plan.full = TableRecord::planStringRecord(std::span(plan.keys).first(count), (1u << count) - 1u);
	return std::make_unique<NativeTableConstructor>(plan);
}

const TableConstructorLayout& NativeTableConstructor::layoutFor(u32 present) {
	if (present == (1u << count) - 1u) return full;
	if (present != partialMask) {
		partial = TableRecord::planStringRecord(std::span(keys).first(count), present);
		partialMask = present;
	}
	return partial;
}

} // namespace bmsx
