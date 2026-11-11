#include "machine/cpu/native_block_compiler.h"

#include "machine/cpu/execution_image.h"
#include "machine/cpu/string_pool.h"

namespace bmsx {

void NativeBlockCompiler::emitComparison(const DecodedInstruction& instruction, NativeBlockExitSite* skipped) {
	const auto op = static_cast<OpCode>(instruction.op);
	const auto [left, right] = readOperands(instruction.b, instruction.c);
	// The owning execution image retains its decoded constant pool for the
	// lifetime of this region, as with embedded RK headers and string IDs.
	// With one Number operand, no tagged pair can compare equal or ordered.
	const bool numericConstant = (instruction.b < 0 && valueIsNumber(m_constants[-instruction.b - 1]))
		|| (instruction.c < 0 && valueIsNumber(m_constants[-instruction.c - 1]));
	// Each comparison owns its flags. sljit_emit_fcmp does not promise flags
	// reusable for a second, different condition on every supported backend.
	auto* unordered = numericConstant ? nullptr
		: sljit_emit_fcmp(m_compiler, SLJIT_UNORDERED, left, 0, right, 0);
	auto* matched = sljit_emit_fcmp(m_compiler, op == OpCode::EQ ? SLJIT_ORDERED_EQUAL
		: op == OpCode::LT ? SLJIT_ORDERED_LESS : SLJIT_ORDERED_LESS_EQUAL, left, 0, right, 0);
	auto* noLabel = sljit_emit_label(m_compiler);
	emitExit(instruction.a != 0 ? skipped : &m_block->terminal);
	auto* yesLabel = sljit_emit_label(m_compiler);
	sljit_set_label(matched, yesLabel);
	emitExit(instruction.a != 0 ? &m_block->terminal : skipped);
	if (numericConstant) return;

	// Ordered numeric true and false paths have already left. Tagged values
	// and numeric NaNs use the cold path without materializing the guest bank.
	sljit_set_label(unordered, sljit_emit_label(m_compiler));
	if (op == OpCode::EQ) {
		if (left != SLJIT_FR0) sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_FR0, 0, left, 0);
		if (right != SLJIT_FR1) sljit_emit_fop1(m_compiler, SLJIT_MOV_F64, SLJIT_FR1, 0, right, 0);
		sljit_emit_ijump(m_compiler, SLJIT_FAST_CALL, SLJIT_IMM,
			reinterpret_cast<sljit_sw>(nativeBlockGate().equalValues));
		sljit_set_label(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32,
			SLJIT_R0, 0, SLJIT_IMM, 0), yesLabel);
	} else {
		loadHeader(instruction.b, SLJIT_R0);
		loadHeader(instruction.c, SLJIT_R1);
		sljit_set_label(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R0, 0,
			SLJIT_IMM, valueString(0) >> 48u), noLabel);
		sljit_set_label(sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL, SLJIT_R1, 0,
			SLJIT_IMM, valueString(0) >> 48u), noLabel);
#if defined(SLJIT_64BIT_ARCHITECTURE)
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, left, SLJIT_R1);
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, right, SLJIT_R2);
#else
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, left, SLJIT_REG_PAIR(SLJIT_R0, SLJIT_R1));
		sljit_emit_fcopy(m_compiler, SLJIT_COPY_FROM_F64, right, SLJIT_REG_PAIR(SLJIT_R0, SLJIT_R2));
#endif
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_R1, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_R2, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(m_bindings.strings));
		// Only the logical budget crosses this nonallocating string kernel;
		// the region's guest register map remains in native registers.
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, remainingCycles), SLJIT_S4, 0);
		sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R3, 0, SLJIT_S3, 0, SLJIT_IMM, offsetof(NativeBlockRunState, remainingCycles));
		emitCallSpills(false);
		sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS4(32, P, 32, 32, P), SLJIT_IMM, SLJIT_FUNC_ADDR(&compareStringIds));
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_S4, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, remainingCycles));
		emitCallSpills(true);
		sljit_set_label(sljit_emit_cmp(m_compiler, (op == OpCode::LT ? SLJIT_SIG_LESS : SLJIT_SIG_LESS_EQUAL) | SLJIT_32,
			SLJIT_R0, 0, SLJIT_IMM, 0), yesLabel);
	}
	sljit_set_label(sljit_emit_jump(m_compiler, SLJIT_JUMP), noLabel);
}

} // namespace bmsx
