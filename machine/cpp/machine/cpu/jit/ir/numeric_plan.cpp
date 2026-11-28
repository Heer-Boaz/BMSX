#include "machine/cpu/jit/ir/numeric_plan.h"

namespace bmsx {

NativeNumericPlan planNativeNumeric(OpCode op, std::optional<ValueTag> left,
	std::optional<ValueTag> right, std::optional<NativeArithmeticFeedback> stableFeedback,
	bool sameOperand, NativeNumericFeedbackMode mode) {
	constexpr auto integer = ValueTag::Integer, floating = ValueTag::Float;
	if (op == OpCode::UNM || op == OpCode::BNOT)
		right = left;
	if ((left && left != integer && left != floating) || (right && right != integer && right != floating))
		return {NativeNumericAction::Fault, left, right, std::nullopt};

	bool guardLeft = false, guardRight = false;
	if (stableFeedback) {
		if (!left) {
			left = stableFeedback->left;
			guardLeft = true;
		}
		if (!right) {
			right = sameOperand ? *left : stableFeedback->right;
			guardRight = !sameOperand;
		}
	}

	const bool logical = op == OpCode::BAND || op == OpCode::BOR || op == OpCode::BXOR;
	const bool bitwise = logical || op == OpCode::SHL || op == OpCode::SHR || op == OpCode::BNOT;
	const bool bothIntegers = left == integer && right == integer;
	const bool forcedFloat = op == OpCode::DIV || op == OpCode::POW;
	const bool producesFloat = !bitwise && (forcedFloat || left == floating || right == floating);
	std::optional<ValueTag> result;
	if (producesFloat)
		result = floating;
	else if (bitwise || bothIntegers)
		result = integer;

	auto action = producesFloat ? NativeNumericAction::Float : NativeNumericAction::Word;
	if ((!left || !right) && mode == NativeNumericFeedbackMode::Polymorphic
		&& (op == OpCode::ADD || op == OpCode::SUB || op == OpCode::MUL))
		action = NativeNumericAction::DynamicNumber;
	else if (logical && !bothIntegers && left != floating && right != floating)
		action = NativeNumericAction::DynamicWord;
	else if (!left || !right || op == OpCode::MOD || op == OpCode::FLOORDIV || op == OpCode::POW || (bitwise && !bothIntegers))
		action = NativeNumericAction::Kernel;
	return {action, left, right, result, guardLeft, guardRight, result.has_value() && !bitwise && !forcedFloat};
}

} // namespace bmsx
