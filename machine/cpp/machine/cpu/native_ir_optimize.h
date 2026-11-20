#pragma once

#include <optional>
#include <span>
#include <vector>
#include "machine/cpu/value_slots.h"

namespace bmsx {

struct NativeInstruction;

struct NativeSlotType {
	u16 slot;
	ValueTag tag;
};

// Guest-slot facts on the successful path. Register assignment and spills
// do not affect these facts. Entry facts must have an explicit admission proof.
class NativeTypePropagation {
public:
	void specialize(std::span<NativeInstruction> instructions, ConstValueSpan constants,
		std::span<const NativeSlotType> entryTypes = {});

private:
	struct Fact {
		size_t block = 0;
		ValueTag tag = ValueTag::Nil;
	};

	std::optional<ValueTag> type(int selector, ConstValueSpan constants) const;
	void define(u16 slot, std::optional<ValueTag> tag);
	void forgetRange(size_t first, size_t end);

	std::vector<Fact> m_facts;
	size_t m_block = 0;
};

} // namespace bmsx
