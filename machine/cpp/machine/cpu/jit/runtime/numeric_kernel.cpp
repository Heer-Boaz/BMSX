#include "machine/cpu/jit/runtime/numeric_kernel.h"

#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/value_arithmetic.h"

namespace bmsx {
namespace {
// Unknown operand subtypes use a nonallocating C++ leaf, not a VM exit. The
// leaf owns the exception boundary: generated frames have no unwind metadata.
// Complete Values are confined to these temporary C++ arguments/results.
template <OpCode op> NativeNumericCompletion numericKernel(const Value* args, Value* out) noexcept {
	try {
		if constexpr (op == OpCode::ADD)
			*out = valueAdd(args[0], args[1]);
		else if constexpr (op == OpCode::SUB)
			*out = valueSubtract(args[0], args[1]);
		else if constexpr (op == OpCode::MUL)
			*out = valueMultiply(args[0], args[1]);
		else if constexpr (op == OpCode::DIV)
			*out = valueDivide(args[0], args[1]);
		else if constexpr (op == OpCode::MOD)
			*out = valueModulo(args[0], args[1]);
		else if constexpr (op == OpCode::FLOORDIV)
			*out = valueFloorDivide(args[0], args[1]);
		else if constexpr (op == OpCode::POW)
			*out = valuePower(args[0], args[1]);
		else if constexpr (op == OpCode::UNM)
			*out = valueNegate(args[0]);
		else if constexpr (op == OpCode::BNOT)
			*out = valueInteger(~integerOperand(args[0]));
		else {
			const i32 left = integerOperand(args[0]), right = integerOperand(args[1]);
			if constexpr (op == OpCode::BAND)
				*out = valueInteger(left & right);
			if constexpr (op == OpCode::BOR)
				*out = valueInteger(left | right);
			if constexpr (op == OpCode::BXOR)
				*out = valueInteger(left ^ right);
			if constexpr (op == OpCode::SHL)
				*out = valueInteger(luaShiftLeft(left, right));
			if constexpr (op == OpCode::SHR)
				*out = valueInteger(luaShiftRight(left, right));
		}
		return NativeNumericCompletion::Completed;
	} catch (const LuaExecutionError&) {
		return NativeNumericCompletion::InvalidOperand;
	}
}

template <OpCode op>
NativeNumericCompletion sample(const Value* args, Value* out, DecodedInstruction* source) noexcept {
	const auto completion = numericKernel<op>(args, out);
	if (completion != NativeNumericCompletion::Completed) return completion;
	const bool stable = source->nativeNumericTypes().stable;
	source->observeNativeNumericTypes(args[0], args[1]);
	return !stable && source->nativeNumericTypes().stable ? NativeNumericCompletion::ProfileReady : completion;
}
} // namespace

u32 nativeWordOperandKernel(const Value* value, u32* out) noexcept { return valueToWord(*value, *out); }

NativeNumericKernel nativeNumericKernel(OpCode op) {
	switch (op) {
	case OpCode::ADD: return &numericKernel<OpCode::ADD>;
	case OpCode::SUB: return &numericKernel<OpCode::SUB>;
	case OpCode::MUL: return &numericKernel<OpCode::MUL>;
	case OpCode::DIV: return &numericKernel<OpCode::DIV>;
	case OpCode::MOD: return &numericKernel<OpCode::MOD>;
	case OpCode::FLOORDIV: return &numericKernel<OpCode::FLOORDIV>;
	case OpCode::POW: return &numericKernel<OpCode::POW>;
	case OpCode::UNM: return &numericKernel<OpCode::UNM>;
	case OpCode::BAND: return &numericKernel<OpCode::BAND>;
	case OpCode::BOR: return &numericKernel<OpCode::BOR>;
	case OpCode::BXOR: return &numericKernel<OpCode::BXOR>;
	case OpCode::SHL: return &numericKernel<OpCode::SHL>;
	case OpCode::SHR: return &numericKernel<OpCode::SHR>;
	case OpCode::BNOT: return &numericKernel<OpCode::BNOT>;
	default: BMSX_UNREACHABLE();
	}
}

NativeSamplingKernel nativeSamplingKernel(OpCode op) {
	switch (op) {
	case OpCode::ADD: return &sample<OpCode::ADD>;
	case OpCode::SUB: return &sample<OpCode::SUB>;
	case OpCode::MUL: return &sample<OpCode::MUL>;
	default: BMSX_UNREACHABLE();
	}
}

} // namespace bmsx
