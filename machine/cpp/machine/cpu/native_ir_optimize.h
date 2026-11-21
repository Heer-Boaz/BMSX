#pragma once

#include <optional>
#include <span>
#include <vector>
#include "machine/cpu/native_ir_ops.h"

namespace bmsx {

struct NativeInstruction;
struct NativeIrBlock;
class NativeRegisterUses;

// Guest-slot facts on the successful path. Register assignment and spills
// do not affect these facts. Entry facts must have an explicit admission proof.
class NativeTypePropagation {
public:
	void specializeRegion(std::span<NativeIrBlock> blocks,
		const NativeRegisterUses& uses, std::vector<NativeSlotType>& imports);
private:
	struct Transfer;
	struct Fact {
		size_t block = 0;
		ValueTag tag = ValueTag::Nil;
		u32 assumption = 0;
	};
	struct Assumption {
		NativeSlotType type;
		u32 source;
		bool required = false;
	};

	using Type = std::optional<Fact>;
	Type type(int selector) const;
	void define(u16 slot, Type type);
	void define(u16 slot, ValueTag tag) { define(slot, Fact{m_block, tag}); }
	void require(Type type);
	void forgetRange(size_t first, size_t end);
	void specialize(std::span<NativeInstruction>, bool inlineBuiltin, size_t first = 0, size_t count = 0);

	std::vector<Fact> m_facts;
	std::vector<Assumption> m_assumptions;
	size_t m_block = 0;
};

} // namespace bmsx
