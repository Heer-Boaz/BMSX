#pragma once

#include <optional>

#include "common/primitives.h"
#include "machine/cpu/jit/exit_contract.h"
#include "spec/blua32/opcode.h"

namespace bmsx {

enum class NativeNumericAction : u8 { Fault, Kernel, Word, Float, DynamicNumber };
enum class NativeNumericFeedbackMode : u8 { None, Sampling, Polymorphic };

struct NativeNumericPlan {
	NativeNumericAction action;
	std::optional<ValueTag> left, right, result;
	bool guardLeft = false, guardRight = false;
	bool resultDependsOnInputs = false;
	// Consumed by IR exit planning, never used by the emitter.
	std::optional<NativeArithmeticFeedback> feedbackAssumption{};
	bool sampleOperands = false;
};

// Missing tags are unknown, not BLua Nil. Guarded tags only hold on the
// successful edge; the other edge executes the original guest instruction.
NativeNumericPlan planNativeNumeric(OpCode op, std::optional<ValueTag> left,
	std::optional<ValueTag> right, std::optional<NativeArithmeticFeedback> stableFeedback,
	bool sameOperand, NativeNumericFeedbackMode mode = NativeNumericFeedbackMode::None);

} // namespace bmsx
