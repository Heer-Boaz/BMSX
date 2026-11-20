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
u32 wordKernel(const Value* value,u32* out) noexcept { return valueToWord(*value,*out); }
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

void NativeBlockCompiler::emitWordOperand(int selector,NativeBlockExitSite& invalid) {
	if(knownTag(selector)==static_cast<int>(ValueTag::Integer)) {
		const auto source=readTyped(selector,ValueTag::Integer);
		if(source.reg!=SLJIT_R0)sljit_emit_op1(m_compiler,SLJIT_MOV32,SLJIT_R0,0,source.reg,0);
		return;
	}
	emitRawLoad(selector,SLJIT_R0,SLJIT_R1);
	auto* integer=knownTag(selector)<0?sljit_emit_cmp(m_compiler,SLJIT_EQUAL|SLJIT_32,
		SLJIT_R1,0,SLJIT_IMM,static_cast<u8>(ValueTag::Integer)):nullptr;
	constexpr sljit_sw input=NativeBlockAbi::helperResultOffset, output=input+sizeof(Value);
	emitValueTransportStore(m_compiler,SLJIT_SP,input,SLJIT_R0,SLJIT_R1);
	const auto state=m_cache.state();m_cache.spillCall(false,0);
	sljit_get_local_base(m_compiler, SLJIT_R0, 0, input);
	sljit_get_local_base(m_compiler, SLJIT_R1, 0, output);
	sljit_emit_icall(m_compiler,SLJIT_CALL,SLJIT_ARGS2(32,P,P),SLJIT_IMM,SLJIT_FUNC_ADDR(wordKernel));
	m_cache.spillCall(true,0);
	fault(sljit_emit_cmp(m_compiler,SLJIT_EQUAL|SLJIT_32,SLJIT_R0,0,SLJIT_IMM,0),invalid,state);
	sljit_emit_op1(m_compiler,SLJIT_MOV32,SLJIT_R0,0,SLJIT_MEM1(SLJIT_SP),output);
	if(integer)sljit_set_label(integer,sljit_emit_label(m_compiler));
}

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
	sljit_get_local_base(m_compiler, SLJIT_R0, 0, args);
	sljit_get_local_base(m_compiler, SLJIT_R1, 0, result);
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
void NativeBlockCompiler::emitFloatInput(int selector, ValueTag tag, sljit_s32 destination) {
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
void NativeBlockCompiler::emitNumeric(const DecodedInstruction& instruction, NativeBlockExitSite& invalid, u32 pc) {
	const auto op = static_cast<OpCode>(instruction.op);
	const bool unary = op == OpCode::UNM || op == OpCode::BNOT;
	int left = knownTag(instruction.b), right = unary ? left : knownTag(instruction.c);
	const int integer = static_cast<int>(ValueTag::Integer), floating = static_cast<int>(ValueTag::Float);
	if ((left >= 0 && left != integer && left != floating) || (right >= 0 && right != integer && right != floating)) {
		fault(sljit_emit_jump(m_compiler, SLJIT_JUMP), invalid, m_cache.state());
		return;
	}
	const bool bits = op == OpCode::BAND || op == OpCode::BOR || op == OpCode::BXOR || op == OpCode::SHL ||
					  op == OpCode::SHR || op == OpCode::BNOT;
	// Keep a warm numeric value on the host side of the register cache.
	// Once one operand is typed, a single remaining guard is enough even
	// when a comparison or another computation, rather than a store, uses it.
	// A type miss retries this instruction, not the already executed prefix.
	if ((left < 0 || right < 0) && (op == OpCode::ADD || op == OpCode::SUB || op == OpCode::MUL)) {
		const auto observed = instruction.nativeNumericTypes();
		if (observed.stable && observed.left != ValueTag::Nil) {
			const auto instructions = m_sources[m_current].instructions;
			const bool feedsStore = m_instruction < instructions.size()
				&& instructions[m_instruction].decoded->op == static_cast<u8>(OpCode::SETFIELD)
				&& instructions[m_instruction].decoded->c == instruction.a;
			if (left >= 0 || right >= 0 || feedsStore) {
				const auto guard = [&](int operand, ValueTag tag) {
					deferColdExit(m_cache.guard(operand, tag, SLJIT_R0), nullptr, pc,
						m_cache.state(), true, m_prefixCycles, m_prefixTop);
					return static_cast<int>(tag);
				};
				if (left < 0) left = guard(instruction.b, observed.left);
				if (right < 0) right = instruction.c == instruction.b ? left : guard(instruction.c, observed.right);
			}
		}
	}
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
		emitFloatInput(instruction.b, static_cast<ValueTag>(left), SLJIT_FR0);
		emitFloatInput(instruction.c, static_cast<ValueTag>(right), SLJIT_FR1);
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
