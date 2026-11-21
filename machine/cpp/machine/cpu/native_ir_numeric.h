#pragma once

#include <optional>

#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "spec/blua32/opcode.h"

namespace bmsx {

// A stable pair observed after a successful ADD, SUB or MUL. The translator
// passes no feedback for other operations or before the pair stabilizes.
struct NativeArithmeticFeedback {
	ValueTag left, right;
};

enum class NativeNumericAction : u8 { Fault, Kernel, Word, Float };

struct NativeNumericPlan {
	NativeNumericAction action;
	std::optional<ValueTag> left, right, result;
	bool guardLeft = false, guardRight = false;
	bool resultDependsOnInputs = false;
};

// Missing tags are unknown, not BLua Nil. Guarded tags only hold on the
// successful edge; the other edge executes the original guest instruction.
NativeNumericPlan planNativeNumeric(OpCode op, std::optional<ValueTag> left,
	std::optional<ValueTag> right, std::optional<NativeArithmeticFeedback> stableFeedback,
	bool sameOperand);

} // namespace bmsx
