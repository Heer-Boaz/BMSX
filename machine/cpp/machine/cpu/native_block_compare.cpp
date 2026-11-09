#include "machine/cpu/native_block_compiler.h"

#include "machine/cpu/execution_image.h"
#include "machine/cpu/string_pool.h"

namespace bmsx {

void NativeBlockCompiler::emitComparison(const DecodedInstruction& instruction, const NativeBlockExitSite* skipped) {
	const auto op = static_cast<OpCode>(instruction.op);
	std::array<sljit_jump*, 8> yes, no;
	size_t yesCount = 0, noCount = 0;
	loadOperand(instruction.c, SLJIT_FR1);
	loadOperand(instruction.b, SLJIT_FR0);
	yes[yesCount++] = sljit_emit_fcmp(m_compiler, op == OpCode::EQ ? SLJIT_ORDERED_EQUAL
		: op == OpCode::LT ? SLJIT_ORDERED_LESS : SLJIT_ORDERED_LESS_EQUAL, SLJIT_FR0, 0, SLJIT_FR1, 0);
	loadHeader(instruction.b, SLJIT_R0);
	loadHeader(instruction.c, SLJIT_R1);
	if (op == OpCode::EQ) {
		no[noCount++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R0, 0, SLJIT_R1, 0);
		for (const auto tag : {ValueTag::Nil, ValueTag::False, ValueTag::True}) {
			yes[yesCount++] = sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R0, 0,
				SLJIT_IMM, valueFromTag(tag) >> 48u);
		}
		auto* string = sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, valueString(0) >> 48u);
		auto* builtin = sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R0, 0,
			SLJIT_IMM, valueFromTag(ValueTag::BuiltinFunction) >> 48u);
		// Raw identity is meaningful for tagged references, not numeric NaNs.
		sljit_emit_op2(m_compiler, SLJIT_AND, SLJIT_R1, 0, SLJIT_R0, 0, SLJIT_IMM, VALUE_QNAN_MASK >> 48u);
		no[noCount++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R1, 0,
			SLJIT_IMM, VALUE_QNAN_MASK >> 48u);
		sljit_emit_op2(m_compiler, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, VALUE_ENCODED_TAG_MASK >> 48u);
		no[noCount++] = sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, 0);
#if defined(SLJIT_64BIT_ARCHITECTURE)
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_R0);
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR1, SLJIT_R1);
#else
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_R0);
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR1, SLJIT_R1);
		no[noCount++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R0, 0, SLJIT_R1, 0);
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_REG_PAIR(SLJIT_R2, SLJIT_R0));
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR1, SLJIT_REG_PAIR(SLJIT_R2, SLJIT_R1));
#endif
		yes[yesCount++] = sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_R1, 0);
		no[noCount++] = sljit_emit_jump(m_compiler, SLJIT_JUMP);
		sljit_set_label(string, sljit_emit_label(m_compiler));
#if defined(SLJIT_64BIT_ARCHITECTURE)
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_R0);
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR1, SLJIT_R1);
#else
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_REG_PAIR(SLJIT_R2, SLJIT_R0));
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR1, SLJIT_REG_PAIR(SLJIT_R2, SLJIT_R1));
#endif
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_R0, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_R1, 0);
		yes[yesCount++] = sljit_emit_cmp(m_compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_R1, 0);
		no[noCount++] = sljit_emit_jump(m_compiler, SLJIT_JUMP);
		sljit_set_label(builtin, sljit_emit_label(m_compiler));
		loadPayload(instruction.b, SLJIT_R0, SLJIT_R2);
		loadPayload(instruction.c, SLJIT_R1, SLJIT_R2);
		sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), offsetof(BuiltinFunction, id));
		sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1), offsetof(BuiltinFunction, id));
		yes[yesCount++] = sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_R1, 0);
	} else {
		no[noCount++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, valueString(0) >> 48u);
		no[noCount++] = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R1, 0, SLJIT_IMM, valueString(0) >> 48u);
#if defined(SLJIT_64BIT_ARCHITECTURE)
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_R1);
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR1, SLJIT_R2);
#else
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_REG_PAIR(SLJIT_R0, SLJIT_R1));
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, SLJIT_FR1, SLJIT_REG_PAIR(SLJIT_R0, SLJIT_R2));
#endif
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_R1, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_R2, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(&m_strings));
		// Terminal compare: guest state is published, and cached FP values have
		// no later consumers. The pure string kernel needs no spill/reload bank.
		sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS3(32, P, 32, 32), SLJIT_IMM, SLJIT_FUNC_ADDR(&compareStringIds));
		yes[yesCount++] = sljit_emit_cmp(m_compiler, (op == OpCode::LT ? SLJIT_SIG_LESS : SLJIT_SIG_LESS_EQUAL) | SLJIT_32,
			SLJIT_R0, 0, SLJIT_IMM, 0);
	}
	auto* noLabel = sljit_emit_label(m_compiler);
	for (size_t i = 0; i < noCount; ++i) sljit_set_label(no[i], noLabel);
	sljit_emit_return(m_compiler, SLJIT_MOV_P, SLJIT_IMM,
		reinterpret_cast<sljit_sw>(instruction.a != 0 ? skipped : &m_block->terminal));
	auto* yesLabel = sljit_emit_label(m_compiler);
	for (size_t i = 0; i < yesCount; ++i) sljit_set_label(yes[i], yesLabel);
	sljit_emit_return(m_compiler, SLJIT_MOV_P, SLJIT_IMM,
		reinterpret_cast<sljit_sw>(instruction.a != 0 ? &m_block->terminal : skipped));
}

} // namespace bmsx
