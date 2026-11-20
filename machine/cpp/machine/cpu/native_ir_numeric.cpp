#include "machine/cpu/native_ir_numeric.h"

namespace bmsx {

NativeNumericPlan planNativeNumeric(OpCode op, std::optional<ValueTag> left,
	std::optional<ValueTag> right, std::optional<NativeArithmeticFeedback> stableFeedback,
	bool sameOperand, bool resultFeedsStore) {
	constexpr auto integer = ValueTag::Integer, floating = ValueTag::Float;
	if (op == OpCode::UNM || op == OpCode::BNOT)
		right = left;
	if ((left && left != integer && left != floating) || (right && right != integer && right != floating))
		return {NativeNumericAction::Fault, left, right, std::nullopt};

	bool guardLeft = false, guardRight = false;
	if (stableFeedback && (left || right || resultFeedsStore)) {
		if (!left) {
			left = stableFeedback->left;
			guardLeft = true;
		}
		if (!right) {
			right = sameOperand ? *left : stableFeedback->right;
			guardRight = !sameOperand;
		}
	}

	const bool bitwise = op == OpCode::BAND || op == OpCode::BOR || op == OpCode::BXOR ||
		op == OpCode::SHL || op == OpCode::SHR || op == OpCode::BNOT;
	const bool bothIntegers = left == integer && right == integer;
	const bool producesFloat = !bitwise &&
		(op == OpCode::DIV || op == OpCode::POW || left == floating || right == floating);
	std::optional<ValueTag> result;
	if (producesFloat)
		result = floating;
	else if (bitwise || bothIntegers)
		result = integer;

	auto action = producesFloat ? NativeNumericAction::Float : NativeNumericAction::Word;
	if (!left || !right || op == OpCode::MOD || op == OpCode::FLOORDIV || op == OpCode::POW || (bitwise && !bothIntegers))
		action = NativeNumericAction::Kernel;
	return {action, left, right, result, guardLeft, guardRight};
}

} // namespace bmsx
