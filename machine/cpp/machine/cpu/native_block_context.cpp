#include "machine/cpu/native_block_compiler.h"
#include "machine/cpu/execution_image.h"

namespace bmsx {
void NativeBlockCompiler::emitContext(const DecodedInstruction& instruction) {
	const auto op = static_cast<OpCode>(instruction.op);
	const bool store = op == OpCode::SETGL || op == OpCode::SETSYS;
	const auto offset = op == OpCode::GETSYS || op == OpCode::SETSYS ? offsetof(NativeBlockRunState, systemGlobalValues)
																	 : offsetof(NativeBlockRunState, globalValues);
	if (store)
		emitRawLoad(instruction.a, SLJIT_R0, SLJIT_R1);
	sljit_emit_op1(
		m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state), offset + ValueSpan::wordsOffset());
	sljit_emit_op1(m_compiler, SLJIT_MOV32, store ? SLJIT_MEM1(SLJIT_R2) : SLJIT_R0,
		store ? instruction.bx * sizeof(u32) : 0, store ? SLJIT_R0 : SLJIT_MEM1(SLJIT_R2),
		store ? 0 : instruction.bx * sizeof(u32));
	sljit_emit_op1(
		m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state), offset + ValueSpan::tagsOffset());
	sljit_emit_op1(m_compiler, SLJIT_MOV_U8, store ? SLJIT_MEM1(SLJIT_R2) : SLJIT_R1, store ? instruction.bx : 0,
		store ? SLJIT_R1 : SLJIT_MEM1(SLJIT_R2), store ? 0 : instruction.bx);
	if (!store)
		emitRawStore(instruction.a, SLJIT_R0, SLJIT_R1);
}
void NativeBlockCompiler::emitNilRange(int first, int count) {
	if (count == 0)
		return;
	m_cache.discardRange(first, first + count);
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R0, 0, NativeBlockAbi::words, 0, SLJIT_IMM, first * sizeof(u32));
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R1, 0, NativeBlockAbi::tags, 0, SLJIT_IMM, first);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_IMM, count);
	auto* loop = sljit_emit_label(m_compiler);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R0), 0, SLJIT_IMM, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R1), 0, SLJIT_IMM, 0);
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, sizeof(u32));
	sljit_emit_op2(m_compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
	sljit_emit_op2(m_compiler, SLJIT_SUB32 | SLJIT_SET_Z, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 1);
	sljit_set_label(sljit_emit_jump(m_compiler, SLJIT_NOT_ZERO), loop);
}
} // namespace bmsx
