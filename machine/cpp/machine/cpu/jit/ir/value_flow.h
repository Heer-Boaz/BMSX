#pragma once

#include "machine/cpu/jit/ir/region.h"

namespace bmsx {

// The definition of one scalar input in a straight-line source run. The
// output slot distinguishes results of the same instruction; a copy forwards
// the original value rather than acquiring a new identity.
struct NativeValueOrigin {
	static constexpr u16 Input = std::numeric_limits<u16>::max();
	static constexpr u16 Unknown = Input - 1;
	u16 producer = Input;
	NativeValueRef slot = NATIVE_NO_OPERAND;
	bool operator==(const NativeValueOrigin&) const = default;
};

// Run-local definitions for the individually named operands, independent of
// native register residency. Ranges contribute definitions, not scalar uses. Open result ranges kill earlier definitions
// without claiming that the runtime writes every candidate slot.
class NativeRunValues {
public:
	explicit NativeRunValues(std::span<const NativeInstruction> instructions);
	const std::array<NativeValueOrigin, 3>& inputs(size_t instruction) const { return m_inputs[instruction]; }

private:
	std::array<std::array<NativeValueOrigin, 3>, NATIVE_BLOCK_MAX_INSTRUCTIONS> m_inputs;
};

} // namespace bmsx
