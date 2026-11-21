#include "machine/cpu/jit/ir/value_flow.h"

#include <algorithm>

#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/jit/ir/region.h"

namespace bmsx {
namespace {

bool copiesReceiver(const NativeOperation& operation) {
	const auto* table = std::get_if<NativeTableAccess>(&operation);
	return table && table->mode == NativeTableMode::ReadMethod;
}

} // namespace

NativeSlotValues::NativeSlotValues(std::span<const NativeInstruction> instructions) {
	// A scope can name each region slot once plus up to three transient pool
	// reads and one fresh result per row. Range-only slots consume no entries.
	static_assert(5u * DECODED_PAGE_WORDS + 4u * NATIVE_BLOCK_MAX_INSTRUCTIONS < std::numeric_limits<u16>::max());
	m_slots.reserve(4u * instructions.size());
	for (const auto& instruction : instructions) {
		const auto& access = instruction.slots;
		for (const auto slot : access.reads)
			if (slot >= 0) m_slots.push_back({static_cast<NativeSlot>(slot)});
		if (access.writes.count == 1 || copiesReceiver(instruction.operation))
			m_slots.push_back({static_cast<NativeSlot>(access.writes.first)});
	}
	std::ranges::sort(m_slots, {}, &Binding::slot);
	m_slots.erase(std::ranges::unique(m_slots, {}, &Binding::slot).begin(), m_slots.end());
	m_origins.reserve(m_slots.size() + 4u * std::min<size_t>(instructions.size(), NATIVE_BLOCK_MAX_INSTRUCTIONS));
}

void NativeSlotValues::beginScope() {
	++m_generation;
	m_origins.clear();
}

NativeValueId NativeSlotValues::create(u16 producer, NativeValueRef slot) {
	m_origins.push_back({producer, slot});
	return static_cast<NativeValueId>(m_origins.size());
}

NativeValueId NativeSlotValues::read(Binding& binding) {
	if (binding.generation != m_generation) {
		binding.generation = m_generation;
		binding.producer = NativeValueOrigin::Entry;
		binding.value = NativeValueId::None;
	}
	if (binding.value == NativeValueId::None)
		binding.value = create(binding.producer, static_cast<NativeValueRef>(binding.slot));
	return binding.value;
}

NativeValueId NativeSlotValues::slot(NativeSlot slot) {
	return read(*std::ranges::lower_bound(m_slots, slot, {}, &Binding::slot));
}

NativeValueId NativeSlotValues::current(NativeSlot slot) const {
	const auto& binding = *std::ranges::lower_bound(m_slots, slot, {}, &Binding::slot);
	return binding.generation == m_generation ? binding.value : NativeValueId::None;
}

NativeRowValues NativeSlotValues::advance(const NativeInstruction& instruction, u16 row) {
	NativeRowValues values;
	const auto& access = instruction.slots;
	for (size_t input = 0; input < access.reads.size(); ++input) {
		const auto selector = access.reads[input];
		if (selector == NATIVE_NO_OPERAND) continue;
		if (selector >= 0) {
			values.inputs[input] = slot(static_cast<NativeSlot>(selector));
		} else {
			// One operation observes a given pool selector once logically.
			// Across operations the RAM-backed pool is not an immutable value.
			const auto previous = std::span(access.reads).first(input);
			const auto same = std::ranges::find(previous, selector);
			values.inputs[input] = same == previous.end() ? create(row, selector) : values.inputs[same - previous.begin()];
		}
	}

	const auto range = access.writes;
	if (range.count == 0 && !range.open) return values;
	const auto* move = std::get_if<NativeMove>(&instruction.operation);
	const bool copy = move && move->conversion == ValueMoveKind::Copy;
	const bool receiver = copiesReceiver(instruction.operation);
	const bool clear = std::holds_alternative<NativeClearSlots>(instruction.operation);
	const auto producer = range.open ? NativeValueOrigin::Opaque : row;
	const auto end = range.end();
	auto out = std::ranges::lower_bound(m_slots, range.first, {}, &Binding::slot);
	for (; out != m_slots.end() && out->slot < end; ++out) {
		out->generation = m_generation;
		out->producer = producer;
		out->value = copy || (receiver && out->slot != range.first) ? values.inputs[0] : NativeValueId::None;
		if (clear) {
			// Every written lane carries exactly the same Nil value.
			if (values.result == NativeValueId::None) values.result = create(row, static_cast<i16>(range.first));
			out->value = values.result;
		} else if ((range.count == 1 || receiver) && out->slot == range.first) {
			values.result = read(*out);
		}
	}
	return values;
}

} // namespace bmsx
