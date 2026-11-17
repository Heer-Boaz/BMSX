#include "machine/cpu/native_block_compiler.h"
#include "machine/cpu/native_value_emit.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/value_arithmetic.h"

namespace bmsx {
namespace {
// Unknown operand subtypes use a nonallocating C++ leaf, not a VM exit. The
// leaf owns the exception boundary: generated frames have no unwind metadata.
// Complete Values are confined to these temporary C++ arguments/results.
template <OpCode op> u32 numericKernel(const Value* args, Value* out) noexcept {
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
		return 0;
	} catch (const LuaExecutionError& error) {
		return error.reason;
	}
}
using Kernel = u32 (*)(const Value*, Value*) noexcept;
Kernel kernelFor(OpCode op) {
	switch (op) {
#define KERNEL(OP)                                                                                                     \
	case OpCode::OP:                                                                                                   \
		return &numericKernel<OpCode::OP>;
		KERNEL(ADD)
		KERNEL(SUB)
		KERNEL(MUL) KERNEL(DIV) KERNEL(MOD) KERNEL(FLOORDIV) KERNEL(POW) KERNEL(UNM) KERNEL(BNOT) KERNEL(BAND)
			KERNEL(BOR) KERNEL(BXOR) KERNEL(SHL) KERNEL(SHR)
#undef KERNEL
				default : BMSX_UNREACHABLE();
	}
}
} // namespace

void NativeBlockCompiler::emitNumericKernel(
	const DecodedInstruction& instruction, NativeBlockExitSite& invalid, int resultTag) {
	constexpr sljit_sw args = NativeBlockAbi::helperResultOffset, result = args + 2 * sizeof(Value);
	const auto op = static_cast<OpCode>(instruction.op);
	emitRawLoad(instruction.b, SLJIT_R0, SLJIT_R1);
	emitValueTransportStore(m_compiler, SLJIT_SP, args, SLJIT_R0, SLJIT_R1);
	if (op != OpCode::UNM && op != OpCode::BNOT) {
		emitRawLoad(instruction.c, SLJIT_R0, SLJIT_R1);
		emitValueTransportStore(m_compiler, SLJIT_SP, args + sizeof(Value), SLJIT_R0, SLJIT_R1);
	}
	const auto prefix = m_cache.state();
	m_cache.spillCall(false, 0);
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R0, 0, SLJIT_SP, 0, SLJIT_IMM, args);
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_SP, 0, SLJIT_IMM, result);
	sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS2(32, P, P), SLJIT_IMM, SLJIT_FUNC_ADDR(kernelFor(op)));
	m_cache.spillCall(true, 0);
	fault(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0), invalid, prefix);
	emitValueTransportLoad(m_compiler, SLJIT_SP, result, SLJIT_R0, SLJIT_R1);
	if (resultTag < 0)
		emitRawStore(instruction.a, SLJIT_R0, SLJIT_R1);
	else {
		const auto target = m_cache.write(instruction.a, static_cast<ValueTag>(resultTag));
		if (target.tag == ValueTag::Float)
			sljit_emit_fcopy(m_compiler, SLJIT_COPY32_TO_F32, target.reg, SLJIT_R0);
		else
			sljit_emit_op1(m_compiler, SLJIT_MOV32, target.reg, 0, SLJIT_R0, 0);
	}
}
void NativeBlockCompiler::emitFloatInput(int selector, sljit_s32 destination) {
	const auto tag = static_cast<ValueTag>(knownTag(selector));
	const auto source = readTyped(selector, tag, SLJIT_R0, destination);
	if (tag == ValueTag::Integer)
		sljit_emit_fop1(m_compiler, SLJIT_CONV_F32_FROM_S32, destination, 0, source.reg, 0);
	else if (source.reg != destination)
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F32, destination, 0, source.reg, 0);
}
void NativeBlockCompiler::emitFloatCanonicalization(sljit_s32 reg) {
	auto* ordinary = sljit_emit_fcmp(m_compiler, SLJIT_ORDERED | SLJIT_32, reg, 0, reg, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM, BLUA32_FLOAT_NAN);
	sljit_emit_fcopy(m_compiler, SLJIT_COPY32_TO_F32, reg, SLJIT_R0);
	sljit_set_label(ordinary, sljit_emit_label(m_compiler));
}
void NativeBlockCompiler::emitNumeric(const DecodedInstruction& instruction, NativeBlockExitSite& invalid) {
	const auto op = static_cast<OpCode>(instruction.op);
	const bool unary = op == OpCode::UNM || op == OpCode::BNOT;
	const int left = knownTag(instruction.b), right = unary ? left : knownTag(instruction.c);
	const int integer = static_cast<int>(ValueTag::Integer), floating = static_cast<int>(ValueTag::Float);
	if ((left >= 0 && left != integer && left != floating) || (right >= 0 && right != integer && right != floating)) {
		fault(sljit_emit_jump(m_compiler, SLJIT_JUMP), invalid, m_cache.state());
		return;
	}
	const bool bits = op == OpCode::BAND || op == OpCode::BOR || op == OpCode::BXOR || op == OpCode::SHL ||
					  op == OpCode::SHR || op == OpCode::BNOT;
	if (left < 0 || right < 0 || op == OpCode::MOD || op == OpCode::FLOORDIV || op == OpCode::POW ||
		(bits && (left != integer || right != integer))) {
		const int tag = bits																			  ? integer
						: op == OpCode::DIV || op == OpCode::POW || left == floating || right == floating ? floating
						: left == integer && right == integer											  ? integer
																										  : -1;
		emitNumericKernel(instruction, invalid, tag);
		return;
	}
	if (op == OpCode::DIV || (!bits && (left == floating || right == floating))) {
		if (op == OpCode::UNM) {
			const auto source = readTyped(instruction.b, ValueTag::Float);
			const auto target = m_cache.write(instruction.a, ValueTag::Float);
			sljit_emit_fop1(m_compiler, SLJIT_NEG_F32, target.reg, 0, source.reg, 0);
			return;
		}
		emitFloatInput(instruction.b, SLJIT_FR0);
		emitFloatInput(instruction.c, SLJIT_FR1);
		const auto target = m_cache.write(instruction.a, ValueTag::Float);
		sljit_emit_fop2(m_compiler,
			op == OpCode::ADD	? SLJIT_ADD_F32
			: op == OpCode::SUB ? SLJIT_SUB_F32
			: op == OpCode::MUL ? SLJIT_MUL_F32
								: SLJIT_DIV_F32,
			target.reg, 0, SLJIT_FR0, 0, SLJIT_FR1, 0);
		emitFloatCanonicalization(target.reg);
		return;
	}
	const auto a = readTyped(instruction.b, ValueTag::Integer, SLJIT_R0);
	if (unary) {
		const auto target = m_cache.write(instruction.a, ValueTag::Integer);
		if (op == OpCode::UNM)
			sljit_emit_op2(m_compiler, SLJIT_SUB32, target.reg, 0, SLJIT_IMM, 0, a.reg, 0);
		else
			sljit_emit_op2(m_compiler, SLJIT_XOR32, target.reg, 0, a.reg, 0, SLJIT_IMM, -1);
		return;
	}
	const auto b = readTyped(instruction.c, ValueTag::Integer, SLJIT_R1);
	const auto target = m_cache.write(instruction.a, ValueTag::Integer);
	if (op == OpCode::SHL || op == OpCode::SHR) {
		auto* negative = sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS | SLJIT_32, b.reg, 0, SLJIT_IMM, 0);
		auto* zeroPositive = sljit_emit_cmp(m_compiler, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, b.reg, 0, SLJIT_IMM, 32);
		sljit_emit_op2(m_compiler, op == OpCode::SHL ? SLJIT_SHL32 : SLJIT_LSHR32, target.reg, 0, a.reg, 0, b.reg, 0);
		auto* positiveDone = sljit_emit_jump(m_compiler, SLJIT_JUMP);
		sljit_set_label(negative, sljit_emit_label(m_compiler));
		auto* zeroNegative = sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, b.reg, 0, SLJIT_IMM, -32);
		sljit_emit_op2(m_compiler, SLJIT_SUB32, SLJIT_R2, 0, SLJIT_IMM, 0, b.reg, 0);
		sljit_emit_op2(
			m_compiler, op == OpCode::SHL ? SLJIT_LSHR32 : SLJIT_SHL32, target.reg, 0, a.reg, 0, SLJIT_R2, 0);
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
	const sljit_s32 operation = op == OpCode::ADD	 ? SLJIT_ADD32
								: op == OpCode::SUB	 ? SLJIT_SUB32
								: op == OpCode::MUL	 ? SLJIT_MUL32
								: op == OpCode::BAND ? SLJIT_AND32
								: op == OpCode::BOR	 ? SLJIT_OR32
													 : SLJIT_XOR32;
	sljit_emit_op2(m_compiler, operation, target.reg, 0, a.reg, 0, b.reg, 0);
}
} // namespace bmsx
