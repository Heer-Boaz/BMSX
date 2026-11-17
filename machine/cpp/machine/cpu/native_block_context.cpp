#include "machine/cpu/native_block_compiler.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/native_value_emit.h"
#include "machine/cpu/call_state.h"
#include "machine/cpu/closure.h"

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
void NativeBlockCompiler::emitConstantIndex(const DecodedInstruction& instruction, NativeBlockExitSite& invalid) {
	emitWordOperand(instruction.b, invalid);
	fault(sljit_emit_cmp(m_compiler, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, m_constants.size()),
		invalid, m_cache.state());
	sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_R0, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, constants) + ConstValueSpan::wordsOffset());
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM2(SLJIT_R1, SLJIT_R2), 2);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, constants) + ConstValueSpan::tagsOffset());
	sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM2(SLJIT_R1, SLJIT_R2), 0);
	emitRawStore(instruction.a, SLJIT_R0, SLJIT_R1);
}

void NativeBlockCompiler::emitUpvalue(const DecodedInstruction& instruction, NativeBlockExitSite* openWrite) {
	sljit_emit_op1(
		m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, frame));
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, closure));
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), Closure::nativeUpvaluesOffset());
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), instruction.b * sizeof(u32));
#if UINTPTR_MAX > UINT32_MAX
	sljit_emit_op1(
		m_compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, heap));
#endif
	emitObjectReference(m_compiler, SLJIT_R2, SLJIT_R2, SLJIT_R3);
	const auto fields = Upvalue::nativeOffsets();
	sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2), fields.open);
	auto* open = sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
	if (instruction.op == static_cast<u8>(OpCode::SETUP)) {
		fault(open, *openWrite, m_cache.state());
		emitRawLoad(instruction.a, SLJIT_R0, SLJIT_R1);
		sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), fields.valueWord, SLJIT_R0, 0);
		sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R2), fields.valueKind, SLJIT_R1, 0);
		emitGcWriteBarrier(m_compiler, SLJIT_R2, SLJIT_R0, SLJIT_R1);
		return;
	}
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2), fields.valueWord);
	sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R2), fields.valueKind);
	auto* ready = sljit_emit_jump(m_compiler, SLJIT_JUMP);
	sljit_set_label(open, sljit_emit_label(m_compiler));
	// Open cells can alias any active register window in the shared stack.
	// Publish the dirty snapshot only on this branch; the closed path stays local.
	m_cache.emitState(m_cache.state());
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R2), fields.index);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), fields.frame);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2),
		offsetof(CallFrame, registers) + ValueSpan::wordsOffset());
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM2(SLJIT_R0, SLJIT_R3), 2);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R2),
		offsetof(CallFrame, registers) + ValueSpan::tagsOffset());
	sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM2(SLJIT_R1, SLJIT_R3), 0);
	sljit_set_label(ready, sljit_emit_label(m_compiler));
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
