#pragma once

#include <optional>
#include <span>
#include <vector>
#include "machine/cpu/jit/ir/value_flow.h"

namespace bmsx {

struct NativeInstruction;
struct NativeIrBlock;
class NativeRegisterUses;

// Facts follow captured values on the successful path, independently of
// slot assignment and spills. Entry facts require an explicit admission proof.
class NativeTypePropagation {
public:
	void specializeRegion(std::span<NativeIrBlock> blocks,
		const NativeRegisterUses& uses, NativeSlotValues& values, std::vector<NativeSlotType>& imports);
private:
	struct Transfer;
	struct Fact {
		ValueTag tag = ValueTag::Nil;
		u32 assumption = 0;
	};
	struct Assumption {
		NativeSlotType type;
		u32 source;
		bool required = false;
	};

	using Type = std::optional<Fact>;
	Type type(NativeValueId value) const;
	void define(NativeValueId value, Fact fact);
	void define(NativeValueId value, ValueTag tag) { define(value, Fact{tag}); }
	void require(Type type);
	void specialize(std::span<NativeInstruction>, NativeSlotValues& values, bool inlineBuiltin, size_t first = 0, size_t count = 0);

	std::vector<Type> m_facts;
	std::vector<Assumption> m_assumptions;
};

} // namespace bmsx
