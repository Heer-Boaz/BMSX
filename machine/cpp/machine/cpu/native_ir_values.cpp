#include "machine/cpu/native_ir_values.h"

#include <algorithm>

namespace bmsx {

NativeRunValues::NativeRunValues(std::span<const NativeInstruction> instructions) {
	std::array<NativeValueRef, NATIVE_BLOCK_MAX_INSTRUCTIONS * NativeSlotAccess{}.reads.size()> readSlots;
	size_t count = 0;
	for (const auto& instruction : instructions)
		for (const auto slot : instruction.slots.reads)
			if (slot >= 0) readSlots[count++] = slot;
	auto slots = std::span(readSlots).first(count);
	std::ranges::sort(slots);
	slots = slots.first(std::ranges::unique(slots).begin() - slots.begin());
	std::array<NativeValueOrigin, readSlots.size()> current;
	for (size_t i = 0; i < slots.size(); ++i) current[i] = {NativeValueOrigin::Input, slots[i]};

	for (size_t index = 0; index < instructions.size(); ++index) {
		const auto& instruction = instructions[index];
		auto& inputs = m_inputs[index];
		for (size_t operand = 0; operand < inputs.size(); ++operand) {
			const auto slot = instruction.slots.reads[operand];
			inputs[operand] = slot < 0 ? NativeValueOrigin{NativeValueOrigin::Input, slot}
				: current[std::ranges::lower_bound(slots, slot) - slots.begin()];
		}
		const auto range = instruction.slots.writes;
		if (range.count == 0 && !range.open) continue;
		const auto* move = std::get_if<NativeMove>(&instruction.operation);
		const bool copy = move && move->conversion == ValueMoveKind::Copy;
		const auto producer = range.open ? NativeValueOrigin::Unknown : static_cast<u16>(index);
		for (auto out = std::ranges::lower_bound(slots, range.first); out != slots.end() && *out < range.end(); ++out)
			current[out - slots.begin()] = copy ? inputs[0] : NativeValueOrigin{producer, *out};
	}
}

} // namespace bmsx
