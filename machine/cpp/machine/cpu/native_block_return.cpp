#include "machine/cpu/native_block_abi.h"

#include <bit>

#include "machine/cpu/cpu.h"
#include "machine/cpu/native_execution.h"

namespace bmsx {

sljit_label* NativeBlockGate::emitReturnGate(sljit_compiler* compiler, sljit_label* coldDispatch) {
	const auto thread = Thread::nativeOffsets();
	const auto cpu = CPU::nativeFrameOffsets();
	constexpr sljit_sw pointerShift = std::countr_zero(sizeof(void*));
	// The register-cache spill area is dead after shared materialization.
	constexpr sljit_sw exitSlot = offsetof(NativeCallScratch, exit), callerSlot = 8, countSlot = 16, wantedSlot = 20, targetSlot = 24, baseSlot = 32;
	static_assert(baseSlot + sizeof(u32) <= NativeBlockAbi::stackBytes);
	auto* entry = sljit_emit_label(compiler);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), exitSlot, SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, frame));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, nativeControl));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(FrameField::Protected));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, -1), coldDispatch);
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(FrameField::Flags),
		SLJIT_IMM, FRAME_COMPLETION);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0), coldDispatch);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32,
		SLJIT_MEM1(SLJIT_R3), static_cast<u32>(FrameField::OpenHead), SLJIT_IMM, 0), coldDispatch);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, previous));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0), coldDispatch);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, executionImage));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL, SLJIT_R3, 0,
		SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, executionImage)), coldDispatch);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, nativeControl));
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(FrameField::Flags),
		SLJIT_IMM, FRAME_BANK_MASK);
	// A return from a writable frame must reload this saved selector.
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R3, 0,
		SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeCpuRunState, frameBank)), coldDispatch);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), callerSlot, SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, thread));
	sljit_emit_op2(compiler, SLJIT_SUB, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R2), thread.frameDepth, SLJIT_IMM, 1);
	sljit_emit_op1(compiler, SLJIT_MOV_S32, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeCpuRunState, targetDepth));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_SIG_LESS_EQUAL, SLJIT_R3, 0, SLJIT_R0, 0), coldDispatch);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeCpuRunState, cpu));
	auto* differentThread = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), cpu.haltedThread);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R0), cpu.haltedDepth), coldDispatch);
	sljit_set_label(differentThread, sljit_emit_label(compiler));

	// Both operands use count+1; zero selects the open result range.
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), exitSlot);
	sljit_emit_op1(compiler, SLJIT_MOV32_U16, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R2), offsetof(NativeBlockExitSite, exitA));
	sljit_emit_op1(compiler, SLJIT_MOV32_S16, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2), offsetof(NativeBlockExitSite, exitB));
	auto* openResults = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 1);
	auto* fixedResults = sljit_emit_jump(compiler, SLJIT_JUMP);
	sljit_set_label(openResults, sljit_emit_label(compiler));
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, registerTop), SLJIT_R3, 0);
	auto* positiveResults = sljit_emit_cmp(compiler, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM, 0);
	auto* resultsReady = sljit_emit_label(compiler);
	sljit_set_label(fixedResults, resultsReady);
	sljit_set_label(positiveResults, resultsReady);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), countSlot, SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, nativeControl));
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(FrameField::ReturnCount), SLJIT_IMM, FRAME_WINDOW_MASK);
	auto* openWanted = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0);
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 1);
	auto* fixedWanted = sljit_emit_jump(compiler, SLJIT_JUMP);
	sljit_set_label(openWanted, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_R0, 0);
	sljit_set_label(fixedWanted, sljit_emit_label(compiler));
	// Raw external entries require a positive grant. An exhausting RET completes
	// through the semantic boundary instead of entering its receiving body.
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, NativeBlockAbi::budget, 0, SLJIT_R2, 0), coldDispatch);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), wantedSlot, SLJIT_R2, 0);
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_S1, 0, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(FrameField::ReturnBase), SLJIT_IMM, FRAME_WINDOW_MASK);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), baseSlot, SLJIT_S1, 0);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_S1, 0, SLJIT_S1, 0, SLJIT_R2, 0);
	auto* noSource = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
	auto* noTarget = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0);
	auto* countFits = sljit_emit_cmp(compiler, SLJIT_LESS_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_R2, 0);
	sljit_set_label(countFits, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), exitSlot);
	sljit_emit_op1(compiler, SLJIT_MOV_U16, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R3), offsetof(NativeBlockExitSite, exitA));
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_R3, 0);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_GREATER | SLJIT_32, SLJIT_R0, 0,
		SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, registers) + ValueSpan::sizeOffset()), coldDispatch);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, nativeControl));
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(FrameField::StackBase), SLJIT_IMM, FRAME_WINDOW_MASK);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), callerSlot);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, nativeControl));
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(FrameField::StackBase), SLJIT_IMM, FRAME_WINDOW_MASK);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), baseSlot);
	// An upward copy may overlap its input even at a cached return site.
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_GREATER | SLJIT_32, SLJIT_R0, 0, SLJIT_R3, 0), coldDispatch);
	auto* sourceReady = sljit_emit_label(compiler);
	sljit_set_label(noSource, sourceReady); sljit_set_label(noTarget, sourceReady);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), callerSlot);
	auto* noResults = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_SIG_GREATER | SLJIT_32, SLJIT_S1, 0,
		SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, registers) + ValueSpan::sizeOffset()), coldDispatch);
	sljit_set_label(noResults, sljit_emit_label(compiler));

	// Resolve the continuation before changing either activation. A missing
	// translation returns through the ordinary semantic/fetch boundary once.
	// A published CALL resolves its continuation cell once. Select the
	// current physical bank here: system code may have changed SELECT in the
	// callee. Retirement zeros the cell before freeing its old executable body.
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R2, 0,
		SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeCpuRunState, cartridgeSlot));
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R1, 0,
		SLJIT_IMM, offsetof(CallFrame, nativeContinuationCells));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM2(SLJIT_R3, SLJIT_R2), pointerShift);
	auto* noCell = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R3, 0, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, nativeControl));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(FrameField::Pc));
	// An external write to the suspended activation may redirect its successor.
	auto* cached = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0,
		SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, nativeContinuationPc));
	sljit_set_label(noCell, sljit_emit_label(compiler));
	// An interpreted CALL has no reserved cell. Resolve its current PC just
	// as on native entry.
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, nativeControl));
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(FrameField::Pc));
	emitCodeLookup(compiler, coldDispatch);
	auto* ready = sljit_emit_jump(compiler, SLJIT_JUMP);
	sljit_set_label(cached, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R3), 0);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R3, 0, SLJIT_IMM, 0), coldDispatch);
	sljit_set_label(ready, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), targetSlot, SLJIT_R3, 0);

	// All cold exits precede the placement charge: the helper owns its charge.
	// Admission also proved a positive grant for the receiving body.
	sljit_emit_op2(compiler, SLJIT_SUB32, NativeBlockAbi::budget, 0, NativeBlockAbi::budget, 0,
		SLJIT_MEM1(SLJIT_SP), wantedSlot);

	// Every remaining operation is a raw, allocation-free frame transition.
	// No host observer runs until the next body's own publication boundary.
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, nativeControl));
	emitPublishFrameTop(compiler, SLJIT_R0, SLJIT_S1, SLJIT_R2);
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(FrameField::StackBase), SLJIT_IMM, FRAME_WINDOW_MASK);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, frame));
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), baseSlot);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), exitSlot);
	sljit_emit_op1(compiler, SLJIT_MOV_U16, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), offsetof(NativeBlockExitSite, exitA));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, nativeControl));
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), static_cast<u32>(FrameField::StackBase), SLJIT_IMM, FRAME_WINDOW_MASK);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, thread));
	sljit_emit_op1(compiler, SLJIT_MOV_P, NativeBlockAbi::words, 0, SLJIT_MEM1(SLJIT_R3), thread.stackWords);
	sljit_emit_op1(compiler, SLJIT_MOV_P, NativeBlockAbi::tags, 0, SLJIT_MEM1(SLJIT_R3), thread.stackTags);
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), countSlot);
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), wantedSlot);
	auto* fit = sljit_emit_cmp(compiler, SLJIT_LESS_EQUAL, SLJIT_R2, 0, SLJIT_R3, 0);
	sljit_emit_op1(compiler, SLJIT_MOV, SLJIT_R2, 0, SLJIT_R3, 0);
	sljit_set_label(fit, sljit_emit_label(compiler));
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R2, 0);
	NativeBlockAbi::emitFramePlacement(compiler, false, true);

	// Retire the exact same owner fields as Thread::leaveFrame. Active roots
	// change only after all returned words have reached the caller's window.
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, frame));
	// Scalar RET advances the physical PC before retiring the activation.
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), exitSlot);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R1), offsetof(NativeBlockExitSite, nextPc));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, nativeControl));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), static_cast<u32>(FrameField::Pc), SLJIT_R3, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R3, 0,
		SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, registerTop));
	emitPublishFrameTop(compiler, SLJIT_R2, SLJIT_R3, SLJIT_R1);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, thread));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), callerSlot);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, nativeControl));
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(FrameField::StackBase), SLJIT_IMM, FRAME_WINDOW_MASK);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R3, 0,
		SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, registers) + ValueSpan::sizeOffset());
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R1), thread.stackTop, SLJIT_R3, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R1), thread.currentFrame, SLJIT_R2, 0);
	sljit_emit_op2(compiler, SLJIT_SUB, SLJIT_MEM1(SLJIT_R1), thread.frameDepth,
		SLJIT_MEM1(SLJIT_R1), thread.frameDepth, SLJIT_IMM, 1);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, decodedPage), SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, compilationEntry), SLJIT_IMM, 1);
	for (auto offset : {ValueSpan::wordsOffset(), ValueSpan::tagsOffset(), ValueSpan::sizeOffset(), ValueSpan::ramOffset()})
		sljit_emit_op1(compiler, SLJIT_MOV, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, registers) + offset, SLJIT_IMM, 0);
	emitFrameEntry(compiler, targetSlot);

	return entry;
}

} // namespace bmsx
