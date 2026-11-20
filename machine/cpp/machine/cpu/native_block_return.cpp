#include "machine/cpu/native_block_abi.h"

#include <bit>

#include "machine/cpu/cpu.h"
#include "machine/cpu/native_execution.h"

namespace bmsx {

sljit_label* NativeBlockGate::emitReturnGate(sljit_compiler* compiler, sljit_label* coldDispatch) {
	const auto thread = Thread::nativeOffsets();
	const auto cpu = CPU::nativeFrameOffsets();
	constexpr sljit_sw pointerShift = std::countr_zero(sizeof(void*));
	constexpr auto exit = NativeBlockAbi::transitionExit;
	constexpr auto leaving = NativeBlockAbi::wordRegisters[1].reg;
	constexpr auto caller = NativeBlockAbi::wordRegisters[2].reg;
	constexpr auto target = NativeBlockAbi::wordRegisters[3].reg;
	// The register-cache spill area is dead after shared materialization.
	constexpr sljit_sw countSlot = 0, wantedSlot = 4, depthSlot = 8, callerBaseSlot = 12,
		destinationSlot = 16, sourceSlot = 20;
	static_assert(sourceSlot + sizeof(u32) <= NativeBlockAbi::stackBytes);
	auto* entry = sljit_emit_label(compiler);
	sljit_emit_op1(compiler, SLJIT_MOV_P, exit, 0, SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, leaving, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, frame));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(leaving), offsetof(CallFrame, nativeControl));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(FrameField::Protected));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, -1), coldDispatch);
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(FrameField::Flags),
		SLJIT_IMM, FRAME_COMPLETION);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0), coldDispatch);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32,
		SLJIT_MEM1(SLJIT_R3), static_cast<u32>(FrameField::OpenHead), SLJIT_IMM, 0), coldDispatch);
	sljit_emit_op1(compiler, SLJIT_MOV_P, caller, 0, SLJIT_MEM1(leaving), offsetof(CallFrame, previous));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_EQUAL, caller, 0, SLJIT_IMM, 0), coldDispatch);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(leaving), offsetof(CallFrame, executionImage));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL, SLJIT_R3, 0,
		SLJIT_MEM1(caller), offsetof(CallFrame, executionImage)), coldDispatch);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(caller), offsetof(CallFrame, nativeControl));
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(FrameField::Flags),
		SLJIT_IMM, FRAME_BANK_MASK);
	// A return from a writable frame must reload this saved selector.
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R3, 0,
		SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeCpuRunState, frameBank)), coldDispatch);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(leaving), offsetof(CallFrame, thread));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R2), thread.record);
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(ThreadField::FrameDepth), SLJIT_IMM, THREAD_CONTROL_COUNT_MASK);
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), depthSlot, SLJIT_R3, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_S32, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeCpuRunState, targetDepth));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_SIG_LESS_EQUAL, SLJIT_R3, 0, SLJIT_R0, 0), coldDispatch);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeCpuRunState, cpu));
	auto* differentThread = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_MEM1(SLJIT_R2), thread.address,
		SLJIT_MEM1(SLJIT_R0), cpu.haltedThreadAddress);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R0), cpu.haltedDepth), coldDispatch);
	sljit_set_label(differentThread, sljit_emit_label(compiler));

	// Both operands use count+1; zero selects the open result range.
	sljit_emit_op1(compiler, SLJIT_MOV32_U16, SLJIT_R3, 0, SLJIT_MEM1(exit), offsetof(NativeBlockExitSite, exitA));
	sljit_emit_op1(compiler, SLJIT_MOV32_S16, SLJIT_R0, 0, SLJIT_MEM1(exit), offsetof(NativeBlockExitSite, exitB));
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
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(leaving), offsetof(CallFrame, nativeControl));
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
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(caller), offsetof(CallFrame, nativeControl));
	sljit_emit_op2(compiler, SLJIT_AND32, target, 0, SLJIT_MEM1(SLJIT_R1), static_cast<u32>(FrameField::StackBase), SLJIT_IMM, FRAME_WINDOW_MASK);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), callerBaseSlot, target, 0);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R1, 0, target, 0, SLJIT_S1, 0);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_S1, 0, SLJIT_S1, 0, SLJIT_R2, 0);
	auto* noResults = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_SIG_GREATER | SLJIT_32, SLJIT_S1, 0,
		SLJIT_MEM1(caller), offsetof(CallFrame, registers) + ValueSpan::sizeOffset()), coldDispatch);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), destinationSlot, SLJIT_R1, 0);
	// Keep the admitted absolute indices through continuation lookup. Padding
	// with no source values and a discard require no source address.
	auto* countFits = sljit_emit_cmp(compiler, SLJIT_LESS_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_R2, 0);
	sljit_set_label(countFits, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), countSlot, SLJIT_R0, 0);
	auto* noCopy = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U16, SLJIT_R2, 0, SLJIT_MEM1(exit), offsetof(NativeBlockExitSite, exitA));
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_R2, 0);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_GREATER | SLJIT_32, SLJIT_R0, 0,
		SLJIT_MEM1(leaving), offsetof(CallFrame, registers) + ValueSpan::sizeOffset()), coldDispatch);
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(FrameField::StackBase), SLJIT_IMM, FRAME_WINDOW_MASK);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_R2, 0);
	// An upward copy may overlap its input even at a cached return site.
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_GREATER | SLJIT_32, SLJIT_R1, 0, SLJIT_R0, 0), coldDispatch);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), sourceSlot, SLJIT_R0, 0);
	auto* rangesReady = sljit_emit_label(compiler);
	sljit_set_label(noCopy, rangesReady);
	sljit_set_label(noResults, rangesReady);

	// Resolve the continuation before changing either activation. A missing
	// translation returns through the ordinary semantic/fetch boundary once.
	// A published CALL resolves its continuation cell once. Select the
	// current physical bank here: system code may have changed SELECT in the
	// callee. Retirement zeros the cell before freeing its old executable body.
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(caller), offsetof(CallFrame, nativeControl));
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(FrameField::Pc));
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R2, 0,
		SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeCpuRunState, cartridgeSlot));
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R3, 0, caller, 0,
		SLJIT_IMM, offsetof(CallFrame, nativeContinuationCells));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM2(SLJIT_R3, SLJIT_R2), pointerShift);
	auto* noCell = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R3, 0, SLJIT_IMM, 0);
	// An external write to the suspended activation may redirect its successor.
	auto* cached = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0,
		SLJIT_MEM1(caller), offsetof(CallFrame, nativeContinuationPc));
	sljit_set_label(noCell, sljit_emit_label(compiler));
	// Resolve the already loaded guest address if the cached cell does not
	// belong to it or the caller was interpreted.
	emitCodeLookup(compiler, coldDispatch);
	auto* ready = sljit_emit_jump(compiler, SLJIT_JUMP);
	sljit_set_label(cached, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R3), 0);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R3, 0, SLJIT_IMM, 0), coldDispatch);
	sljit_set_label(ready, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV_P, target, 0, SLJIT_R3, 0);

	// All cold exits precede the placement charge: the helper owns its charge.
	// Admission also proved a positive grant for the receiving body.
	sljit_emit_op2(compiler, SLJIT_SUB32, NativeBlockAbi::budget, 0, NativeBlockAbi::budget, 0,
		SLJIT_MEM1(SLJIT_SP), wantedSlot);

	// Every remaining operation is a raw, allocation-free frame transition.
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(caller), offsetof(CallFrame, nativeControl));
	emitPublishFrameTop(compiler, SLJIT_R0, SLJIT_S1, SLJIT_R2);
	auto* discard = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_MEM1(SLJIT_SP), wantedSlot, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(leaving), offsetof(CallFrame, thread));
	sljit_emit_op1(compiler, SLJIT_MOV_P, NativeBlockAbi::words, 0, SLJIT_MEM1(SLJIT_R3), thread.stackWords);
	sljit_emit_op1(compiler, SLJIT_MOV_P, NativeBlockAbi::tags, 0, SLJIT_MEM1(SLJIT_R3), thread.stackTags);
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), destinationSlot);
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), countSlot);
	auto* padOnly = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), sourceSlot);
	sljit_set_label(padOnly, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), wantedSlot);
	auto* multiple = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_IMM, 1);
	// One receiving slot copies the raw pair or supplies one canonical nil.
	auto* singleNil = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM2(NativeBlockAbi::words, SLJIT_R1), 2, SLJIT_MEM2(NativeBlockAbi::words, SLJIT_R0), 2);
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_MEM2(NativeBlockAbi::tags, SLJIT_R1), 0, SLJIT_MEM2(NativeBlockAbi::tags, SLJIT_R0), 0);
	auto* copiedOne = sljit_emit_jump(compiler, SLJIT_JUMP);
	sljit_set_label(singleNil, sljit_emit_label(compiler));
	static_assert(valueNil() == 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM2(NativeBlockAbi::words, SLJIT_R1), 2, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_MEM2(NativeBlockAbi::tags, SLJIT_R1), 0, SLJIT_IMM, 0);
	auto* paddedOne = sljit_emit_jump(compiler, SLJIT_JUMP);

	sljit_set_label(multiple, sljit_emit_label(compiler));
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R2, 0);
	NativeBlockAbi::emitFramePlacement(compiler, false, true);
	auto* placed = sljit_emit_label(compiler);
	sljit_set_label(discard, placed);
	sljit_set_label(copiedOne, placed);
	sljit_set_label(paddedOne, placed);

	// Retire the exact same owner fields as Thread::leaveFrame. Active roots
	// change only after all returned words have reached the caller's window.
	// Scalar RET advances the physical PC before retiring the activation.
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_MEM1(exit), offsetof(NativeBlockExitSite, nextPc));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(leaving), offsetof(CallFrame, nativeControl));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), static_cast<u32>(FrameField::Pc), SLJIT_R3, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R3, 0,
		SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, registerTop));
	emitPublishFrameTop(compiler, SLJIT_R2, SLJIT_R3, SLJIT_R1);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(leaving), offsetof(CallFrame, thread));
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), callerBaseSlot,
		SLJIT_MEM1(caller), offsetof(CallFrame, registers) + ValueSpan::sizeOffset());
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R1), thread.currentFrame, caller, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1), thread.record);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R1), static_cast<u32>(ThreadField::StackTop), SLJIT_R3, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), depthSlot);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R1), static_cast<u32>(ThreadField::FrameDepth), SLJIT_R3, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(leaving), offsetof(CallFrame, decodedPage), SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_MEM1(leaving), offsetof(CallFrame, compilationEntry), SLJIT_IMM, 1);
	for (auto offset : {ValueSpan::wordsOffset(), ValueSpan::tagsOffset(), ValueSpan::sizeOffset(), ValueSpan::ramOffset()})
		sljit_emit_op1(compiler, SLJIT_MOV, SLJIT_MEM1(leaving), offsetof(CallFrame, registers) + offset, SLJIT_IMM, 0);
	emitFrameEntry(compiler, caller, target);

	return entry;
}

} // namespace bmsx
