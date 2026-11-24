#include "machine/cpu/jit/sljit/lowering.h"
#include "machine/cpu/jit/sljit/value_transport.h"
#include "machine/cpu/jit/runtime/numeric_kernel.h"
#include "machine/cpu/decoded_instruction.h"
#include "machine/memory/mapped_page.h"

namespace bmsx {

namespace {
constexpr sljit_s32 binaryFloatOpcode(OpCode op) {
	switch (op) {
		case OpCode::ADD: return SLJIT_ADD_F32;
		case OpCode::SUB: return SLJIT_SUB_F32;
		case OpCode::MUL: return SLJIT_MUL_F32;
		case OpCode::DIV: return SLJIT_DIV_F32;
		default: BMSX_UNREACHABLE();
	}
}

constexpr sljit_s32 binaryWordOpcode(OpCode op) {
	switch (op) {
		case OpCode::ADD: return SLJIT_ADD32;
		case OpCode::SUB: return SLJIT_SUB32;
		case OpCode::MUL: return SLJIT_MUL32;
		case OpCode::BAND: return SLJIT_AND32;
		case OpCode::BOR: return SLJIT_OR32;
		case OpCode::BXOR: return SLJIT_XOR32;
		default: BMSX_UNREACHABLE();
	}
}
} // namespace

void NativeLowering::emitWordOperand(int selector, NativeWordSource source, NativeBlockExitSite& invalid) {
	emitPayload(selector, SLJIT_R0);
	if (source == NativeWordSource::Integer) return;

	sljit_jump* integer = nullptr;
	if (source == NativeWordSource::Dynamic) {
		emitTag(selector, SLJIT_R1);
		integer = sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R1, 0,
			SLJIT_IMM, static_cast<u8>(ValueTag::Integer));
	} else {
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, static_cast<u8>(ValueTag::Float));
	}
	constexpr sljit_sw input = NativeBlockAbi::helperResultOffset, output = input + sizeof(Value);
	emitValueTransportStore(m_compiler, SLJIT_SP, input, SLJIT_R0, SLJIT_R1);
	const auto state = m_cache.state();
	m_cache.spillCall(false, 0);
	sljit_get_local_base(m_compiler, SLJIT_R0, 0, input);
	sljit_get_local_base(m_compiler, SLJIT_R1, 0, output);
	sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS2(32, P, P), SLJIT_IMM, SLJIT_FUNC_ADDR(nativeWordOperandKernel));
	m_cache.spillCall(true, 0);
	fault(sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0), invalid, state);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), output);
	if (integer) sljit_set_label(integer, sljit_emit_label(m_compiler));
}

void NativeLowering::emitNumericKernel(
	const NativeArithmetic& arithmetic, const NativeInstruction& instruction, const NativeNumericPlan& plan) {
	constexpr sljit_sw args = NativeBlockAbi::helperResultOffset, result = args + 2 * sizeof(Value);
	const auto op = arithmetic.operation;
	emitRawLoad(arithmetic.left, SLJIT_R0, SLJIT_R1);
	emitValueTransportStore(m_compiler, SLJIT_SP, args, SLJIT_R0, SLJIT_R1);
	if (!arithmetic.unary()) {
		emitRawLoad(arithmetic.right, SLJIT_R0, SLJIT_R1);
		emitValueTransportStore(m_compiler, SLJIT_SP, args + sizeof(Value), SLJIT_R0, SLJIT_R1);
	}
	const auto prefix = m_cache.state();
	m_cache.spillCall(false, 0);
	sljit_get_local_base(m_compiler, SLJIT_R0, 0, args);
	sljit_get_local_base(m_compiler, SLJIT_R1, 0, result);
	if (plan.sampleOperands) {
		const u32 word = (instruction.pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_IMM,
			reinterpret_cast<sljit_sw>(&m_decodedPage[word]));
		sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS3(32, P, P, P), SLJIT_IMM, SLJIT_FUNC_ADDR(nativeSamplingKernel(op)));
	} else
		sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS2(32, P, P), SLJIT_IMM, SLJIT_FUNC_ADDR(nativeNumericKernel(op)));
	m_cache.spillCall(true, 0);
	fault(sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM,
		static_cast<u32>(NativeNumericCompletion::InvalidOperand)), *sideExit(instruction.slow), prefix);
	emitValueTransportLoad(m_compiler, SLJIT_SP, result, SLJIT_R0, SLJIT_R1);
	if (!plan.result)
		emitRawStore(arithmetic.result, SLJIT_R0, SLJIT_R1);
	else {
		const auto target = m_cache.write(arithmetic.result, *plan.result);
		if (target.tag == ValueTag::Float)
			sljit_emit_fcopy(m_compiler, SLJIT_COPY32_TO_F32, target.reg, SLJIT_R0);
		else
			sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_R0, 0);
	}
}
void NativeLowering::emitFloatInput(int selector, ValueTag tag, sljit_s32 destination) {
	const auto source = readTyped(selector, tag, SLJIT_R0, destination);
	if (tag == ValueTag::Integer)
		sljit_emit_fop1(m_compiler, SLJIT_CONV_F32_FROM_S32, destination, 0, source.reg, 0);
	else if (source.reg != destination)
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F32, destination, 0, source.reg, 0);
}
void NativeLowering::emitFloatCanonicalization(sljit_s32 reg) {
	auto* ordinary = sljit_emit_fcmp(m_compiler, SLJIT_ORDERED | SLJIT_32, reg, 0, reg, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM, BLUA32_FLOAT_NAN);
	sljit_emit_fcopy(m_compiler, SLJIT_COPY32_TO_F32, reg, SLJIT_R0);
	sljit_set_label(ordinary, sljit_emit_label(m_compiler));
}
void NativeLowering::emitDynamicNumeric(const NativeArithmetic& arithmetic,
	const NativeInstruction& instruction, const NativeNumericPlan& plan) {
	auto* c = m_compiler;
	const auto prefix = m_cache.state();
	auto& invalid = *sideExit(instruction.slow);
	constexpr auto integerTag = static_cast<u8>(ValueTag::Integer), floatTag = static_cast<u8>(ValueTag::Float);
	const auto convert = [&](sljit_s32 word, sljit_s32 tag, sljit_s32 dest, bool allowInteger) {
		auto* integer = allowInteger ? sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, tag, 0, SLJIT_IMM, integerTag) : nullptr;
		fault(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, tag, 0, SLJIT_IMM, floatTag), invalid, prefix);
		sljit_emit_fcopy(c, SLJIT_COPY32_TO_F32, dest, word);
		if (integer) {
			auto* done = sljit_emit_jump(c, SLJIT_JUMP);
			sljit_set_label(integer, sljit_emit_label(c));
			sljit_emit_fop1(c, SLJIT_CONV_F32_FROM_S32, dest, 0, word, 0);
			sljit_set_label(done, sljit_emit_label(c));
		}
	};

	// A proven Float always selects the float route. Keep that operand and
	// the success result in the typed cache rather than joining a word arm.
	if (plan.result == ValueTag::Float) {
		const bool leftFloat = plan.left == ValueTag::Float;
		emitRawLoad(leftFloat ? arithmetic.right : arithmetic.left, SLJIT_R0, SLJIT_R1);
		convert(SLJIT_R0, SLJIT_R1, leftFloat ? SLJIT_FR1 : SLJIT_FR0, true);
		emitFloatInput(leftFloat ? arithmetic.left : arithmetic.right, ValueTag::Float, leftFloat ? SLJIT_FR0 : SLJIT_FR1);
		const auto target = m_cache.write(arithmetic.result, ValueTag::Float);
		sljit_emit_fop2(c, binaryFloatOpcode(arithmetic.operation), target.reg, 0, SLJIT_FR0, 0, SLJIT_FR1, 0);
		emitFloatCanonicalization(target.reg);
		return;
	}

	const bool same = arithmetic.left == arithmetic.right;
	const bool leftDynamic = !plan.left, rightDynamic = !same && !plan.right;
	emitPayload(arithmetic.left, SLJIT_R0);
	if (!same) emitPayload(arithmetic.right, SLJIT_R1);
	if (leftDynamic) emitTag(arithmetic.left, SLJIT_R2);
	if (rightDynamic) emitTag(arithmetic.right, SLJIT_R3);
	auto* leftNotInteger = leftDynamic ? sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, integerTag) : nullptr;
	auto* rightNotInteger = rightDynamic ? sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_IMM, integerTag) : nullptr;
	sljit_emit_op2(c, binaryWordOpcode(arithmetic.operation), SLJIT_R0, 0, SLJIT_R0, 0, same ? SLJIT_R0 : SLJIT_R1, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, integerTag);
	auto* integerDone = sljit_emit_jump(c, SLJIT_JUMP);

	auto* floating = sljit_emit_label(c);
	if (leftNotInteger) sljit_set_label(leftNotInteger, floating);
	if (rightNotInteger) sljit_set_label(rightNotInteger, floating);
	// If only one tag is dynamic, reaching this arm already rules out
	// Integer for that tag. Invalid operands leave both guest lanes intact.
	const bool twoDynamic = leftDynamic && rightDynamic;
	if (leftDynamic) convert(SLJIT_R0, SLJIT_R2, SLJIT_FR0, twoDynamic);
	else sljit_emit_fop1(c, SLJIT_CONV_F32_FROM_S32, SLJIT_FR0, 0, SLJIT_R0, 0);
	if (!same) {
		if (rightDynamic) convert(SLJIT_R1, SLJIT_R3, SLJIT_FR1, twoDynamic);
		else sljit_emit_fop1(c, SLJIT_CONV_F32_FROM_S32, SLJIT_FR1, 0, SLJIT_R1, 0);
	}
	sljit_emit_fop2(c, binaryFloatOpcode(arithmetic.operation), SLJIT_FR0, 0, SLJIT_FR0, 0, same ? SLJIT_FR0 : SLJIT_FR1, 0);
	emitFloatCanonicalization(SLJIT_FR0);
	sljit_emit_fcopy(c, SLJIT_COPY32_FROM_F32, SLJIT_FR0, SLJIT_R0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, floatTag);
	sljit_set_label(integerDone, sljit_emit_label(c));
	emitRawStore(arithmetic.result, SLJIT_R0, SLJIT_R1);
}

void NativeLowering::lowerOperation(const NativeArithmetic& arithmetic, const NativeInstruction& instruction) {
	const auto op = arithmetic.operation;
	const bool unary = arithmetic.unary();
	const auto& plan = std::get<NativeNumericPlan>(arithmetic.strategy);
	const auto guard = [&](i16 operand, ValueTag tag) {
		fault(guardTag(operand, tag, SLJIT_R0), *sideExit(instruction.replay), m_cache.state());
	};
	if (plan.guardLeft) guard(arithmetic.left, *plan.left);
	if (plan.guardRight) guard(arithmetic.right, *plan.right);
	switch (plan.action) {
	case NativeNumericAction::Fault:
		BMSX_UNREACHABLE();
	case NativeNumericAction::Kernel:
		emitNumericKernel(arithmetic, instruction, plan);
		return;
	case NativeNumericAction::DynamicNumber:
		emitDynamicNumeric(arithmetic, instruction, plan);
		return;
	case NativeNumericAction::Word:
		break;
	case NativeNumericAction::Float:
		if (op == OpCode::UNM) {
			const auto source = readTyped(arithmetic.left, ValueTag::Float);
			const auto target = m_cache.write(arithmetic.result, ValueTag::Float);
			sljit_emit_fop1(m_compiler, SLJIT_NEG_F32, target.reg, 0, source.reg, 0);
			return;
		}
		emitFloatInput(arithmetic.left, *plan.left, SLJIT_FR0);
		emitFloatInput(arithmetic.right, *plan.right, SLJIT_FR1);
		const auto target = m_cache.write(arithmetic.result, ValueTag::Float);
		sljit_emit_fop2(m_compiler, binaryFloatOpcode(op), target.reg, 0, SLJIT_FR0, 0, SLJIT_FR1, 0);
		emitFloatCanonicalization(target.reg);
		return;
	}
	const bool shift = op == OpCode::SHL || op == OpCode::SHR;
	const auto shiftCount = shift ? m_cache.acquireScratch() : 0;
	const auto a = readTyped(arithmetic.left, ValueTag::Integer, SLJIT_R0);
	if (unary) {
		const auto target = m_cache.write(arithmetic.result, ValueTag::Integer);
		if (op == OpCode::UNM)
			sljit_emit_op2(m_compiler, SLJIT_SUB32, target.reg, 0, SLJIT_IMM, 0, a.reg, 0);
		else
			sljit_emit_op2(m_compiler, SLJIT_XOR32, target.reg, 0, a.reg, 0, SLJIT_IMM, -1);
		return;
	}
	const auto b = readTyped(arithmetic.right, ValueTag::Integer, SLJIT_R1);
	const auto target = m_cache.write(arithmetic.result, ValueTag::Integer);
	if (shift) {
		auto* negative = sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS | SLJIT_32, b.reg, 0, SLJIT_IMM, 0);
		auto* zeroPositive = sljit_emit_cmp(m_compiler, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, b.reg, 0, SLJIT_IMM, 32);
		sljit_emit_op2(m_compiler, op == OpCode::SHL ? SLJIT_SHL32 : SLJIT_LSHR32, target.reg, 0, a.reg, 0, b.reg, 0);
		auto* positiveDone = sljit_emit_jump(m_compiler, SLJIT_JUMP);
		sljit_set_label(negative, sljit_emit_label(m_compiler));
		auto* zeroNegative = sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, b.reg, 0, SLJIT_IMM, -32);
		sljit_emit_op2(m_compiler, SLJIT_SUB32, shiftCount, 0, SLJIT_IMM, 0, b.reg, 0);
		sljit_emit_op2(
			m_compiler, op == OpCode::SHL ? SLJIT_LSHR32 : SLJIT_SHL32, target.reg, 0, a.reg, 0, shiftCount, 0);
		auto* negativeDone = sljit_emit_jump(m_compiler, SLJIT_JUMP);
		auto* zero = sljit_emit_label(m_compiler);
		sljit_set_label(zeroPositive, zero);
		sljit_set_label(zeroNegative, zero);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_IMM, 0);
		auto* done = sljit_emit_label(m_compiler);
		sljit_set_label(positiveDone, done);
		sljit_set_label(negativeDone, done);
		return;
	}
	sljit_emit_op2(m_compiler, binaryWordOpcode(op), target.reg, 0, a.reg, 0, b.reg, 0);
}
} // namespace bmsx
