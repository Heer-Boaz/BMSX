#include "machine/cpu/native_block_abi.h"

namespace bmsx {

sljit_label* NativeBlockGate::emitEqualityGate(sljit_compiler* compiler) {
	auto* entry = sljit_emit_label(compiler);
	// The caller has already found an unordered pair. Retain the fast return
	// address in R3 while testing the exact Value identity rules, not FP NaN
	// equality. No call, allocation or guest-state observation occurs here.
	sljit_emit_op_dst(compiler, SLJIT_FAST_ENTER, SLJIT_R3, 0);
	std::array<sljit_jump*, 6> yes, no;
	size_t yesCount = 0, noCount = 0;
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_R0);
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, SLJIT_FR1, SLJIT_R1);
	sljit_emit_op2(compiler, SLJIT_LSHR, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, sizeof(sljit_sw) * 8u - 16u);
	sljit_emit_op2(compiler, SLJIT_LSHR, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, sizeof(sljit_sw) * 8u - 16u);
	no[noCount++] = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL, SLJIT_R0, 0, SLJIT_R1, 0);
	for (const auto tag : {ValueTag::Nil, ValueTag::False, ValueTag::True}) {
		yes[yesCount++] = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R0, 0,
			SLJIT_IMM, valueFromTag(tag) >> 48u);
	}
	auto* string = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, valueString(0) >> 48u);
	auto* builtin = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R0, 0,
		SLJIT_IMM, valueFromTag(ValueTag::BuiltinFunction) >> 48u);
	// Numeric NaNs remain unequal. Other tagged references compare all raw
	// bits, including representable payload bits outside a host pointer.
	sljit_emit_op2(compiler, SLJIT_AND, SLJIT_R1, 0, SLJIT_R0, 0, SLJIT_IMM, VALUE_QNAN_MASK >> 48u);
	no[noCount++] = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL, SLJIT_R1, 0,
		SLJIT_IMM, VALUE_QNAN_MASK >> 48u);
	sljit_emit_op2(compiler, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, VALUE_ENCODED_TAG_MASK >> 48u);
	no[noCount++] = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, 0);
#if defined(SLJIT_64BIT_ARCHITECTURE)
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_R0);
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, SLJIT_FR1, SLJIT_R1);
#else
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_R0);
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, SLJIT_FR1, SLJIT_R1);
	no[noCount++] = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL, SLJIT_R0, 0, SLJIT_R1, 0);
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_REG_PAIR(SLJIT_R2, SLJIT_R0));
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, SLJIT_FR1, SLJIT_REG_PAIR(SLJIT_R2, SLJIT_R1));
#endif
	yes[yesCount++] = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_R1, 0);
	no[noCount++] = sljit_emit_jump(compiler, SLJIT_JUMP);
	sljit_set_label(string, sljit_emit_label(compiler));
#if defined(SLJIT_64BIT_ARCHITECTURE)
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_R0);
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, SLJIT_FR1, SLJIT_R1);
#else
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_REG_PAIR(SLJIT_R2, SLJIT_R0));
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, SLJIT_FR1, SLJIT_REG_PAIR(SLJIT_R2, SLJIT_R1));
#endif
	yes[yesCount++] = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_R1, 0);
	no[noCount++] = sljit_emit_jump(compiler, SLJIT_JUMP);
	sljit_set_label(builtin, sljit_emit_label(compiler));
#if defined(SLJIT_64BIT_ARCHITECTURE)
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_R0);
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, SLJIT_FR1, SLJIT_R1);
	sljit_emit_op2(compiler, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, VALUE_PAYLOAD_MASK);
	sljit_emit_op2(compiler, SLJIT_AND, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, VALUE_PAYLOAD_MASK);
#else
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, SLJIT_FR0, SLJIT_REG_PAIR(SLJIT_R2, SLJIT_R0));
	sljit_emit_fcopy(compiler, SLJIT_COPY_FROM_F64, SLJIT_FR1, SLJIT_REG_PAIR(SLJIT_R2, SLJIT_R1));
#endif
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), offsetof(BuiltinFunction, id));
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1), offsetof(BuiltinFunction, id));
	yes[yesCount++] = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_R1, 0);
	auto* noLabel = sljit_emit_label(compiler);
	for (size_t index = 0; index < noCount; ++index) sljit_set_label(no[index], noLabel);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM, 0);
	sljit_emit_op_src(compiler, SLJIT_FAST_RETURN, SLJIT_R3, 0);
	auto* yesLabel = sljit_emit_label(compiler);
	for (size_t index = 0; index < yesCount; ++index) sljit_set_label(yes[index], yesLabel);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM, 1);
	sljit_emit_op_src(compiler, SLJIT_FAST_RETURN, SLJIT_R3, 0);
	return entry;
}

} // namespace bmsx
