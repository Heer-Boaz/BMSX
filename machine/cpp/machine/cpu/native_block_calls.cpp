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
	constexpr sljit_sw exitSlot = 0, callerSlot = 8, countSlot = 16, wantedSlot = 20, endSlot = 24;
	static_assert(endSlot + sizeof(void*) <= NativeBlockAbi::stackBytes);
	std::array<sljit_jump*, 16> cold;
	size_t coldCount = 0;
	auto* entry = sljit_emit_label(compiler);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), exitSlot, SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, frame));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, protectedContinuationIndex));
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, -1);
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, returnToCompletionLatch));
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0);
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL,
		SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, openUpvalueHead), SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, previous));
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, executionImage));
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL, SLJIT_R3, 0,
		SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, executionImage));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), callerSlot, SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, thread));
	sljit_emit_op2(compiler, SLJIT_SUB, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R2), thread.frameDepth, SLJIT_IMM, 1);
	sljit_emit_op1(compiler, SLJIT_MOV_S32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeCpuRunState, targetDepth));
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_SIG_LESS_EQUAL, SLJIT_R3, 0, SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeCpuRunState, cpu));
	auto* differentThread = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), cpu.haltedThread);
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R0), cpu.haltedDepth);
	sljit_set_label(differentThread, sljit_emit_label(compiler));

	// Both operands use count+1; zero selects the open result range.
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), exitSlot);
	sljit_emit_op1(compiler, SLJIT_MOV32_U16, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R2), offsetof(NativeBlockExitSite, exitA));
	sljit_emit_op1(compiler, SLJIT_MOV32_S16, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2), offsetof(NativeBlockExitSite, exitB));
	auto* openResults = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 1);
	auto* fixedResults = sljit_emit_jump(compiler, SLJIT_JUMP);
	sljit_set_label(openResults, sljit_emit_label(compiler));
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R0, 0, SLJIT_S5, 0, SLJIT_R3, 0);
	auto* positiveResults = sljit_emit_cmp(compiler, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM, 0);
	auto* resultsReady = sljit_emit_label(compiler);
	sljit_set_label(fixedResults, resultsReady);
	sljit_set_label(positiveResults, resultsReady);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), countSlot, SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, returnCount));
	auto* openWanted = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0);
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 1);
	auto* fixedWanted = sljit_emit_jump(compiler, SLJIT_JUMP);
	sljit_set_label(openWanted, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_R0, 0);
	sljit_set_label(fixedWanted, sljit_emit_label(compiler));
	// Raw external entries require a positive grant. An exhausting RET completes
	// through the semantic boundary instead of entering its receiving body.
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, SLJIT_S4, 0, SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), wantedSlot, SLJIT_R2, 0);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_S5, 0, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, returnBase));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), callerSlot);
	auto* noResults = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0);
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_SIG_GREATER | SLJIT_32, SLJIT_S5, 0,
		SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, stackCapacity));
	sljit_set_label(noResults, sljit_emit_label(compiler));

	// Resolve the continuation before changing either activation. A missing
	// translation returns through the ordinary semantic/fetch boundary once.
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, pc));
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R2, 0, SLJIT_R0, 0, SLJIT_IMM, INSTRUCTION_BYTES - 1u);
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0);
	// A published CALL resolves its continuation cell once. Select the
	// current physical bank here: system code may have changed SELECT in the
	// callee. Retirement zeros the cell before freeing its old executable body.
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R2, 0,
		SLJIT_MEM1(SLJIT_S3), offsetof(NativeCpuRunState, cartridgeSlot));
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R1, 0,
		SLJIT_IMM, offsetof(CallFrame, nativeContinuationCells));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM2(SLJIT_R3, SLJIT_R2), pointerShift);
	auto* uncached = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R3, 0, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_S2, 0, SLJIT_MEM1(SLJIT_R3), 0);
	auto* codeReady = sljit_emit_jump(compiler, SLJIT_JUMP);
	// Interpreter/exception entries have no native CALL binding. They retain
	// ordinary live lookup rather than depending on a previous pooled frame.
	sljit_set_label(uncached, sljit_emit_label(compiler));
	sljit_emit_op2(compiler, SLJIT_LSHR, SLJIT_R2, 0, SLJIT_R0, 0, SLJIT_IMM, NativeCodeLookup::ROOT_SHIFT);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeCpuRunState, codeRoot));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM2(SLJIT_R3, SLJIT_R2), pointerShift);
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R3, 0, SLJIT_IMM, 0);
	sljit_emit_op2(compiler, SLJIT_LSHR, SLJIT_R2, 0, SLJIT_R0, 0, SLJIT_IMM, MAPPED_PAGE_BYTE_SHIFT);
	sljit_emit_op2(compiler, SLJIT_AND, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, NativeCodeLookup::GROUP_PAGES - 1u);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM2(SLJIT_R3, SLJIT_R2), pointerShift);
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R3, 0, SLJIT_IMM, 0);
	static_assert(offsetof(NativeCodeLookup::DispatchPage, code) == 0);
	sljit_emit_op2(compiler, SLJIT_AND, SLJIT_R2, 0, SLJIT_R0, 0, SLJIT_IMM, MAPPED_PAGE_BYTE_MASK);
	sljit_emit_op2(compiler, SLJIT_LSHR, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 2);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_S2, 0, SLJIT_MEM2(SLJIT_R3, SLJIT_R2), pointerShift);
	sljit_set_label(codeReady, sljit_emit_label(compiler));
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_S2, 0, SLJIT_IMM, 0);

	// All cold exits precede the placement charge: the helper owns its charge.
	// Admission also proved a positive grant for the receiving body.
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_S4, 0, SLJIT_S4, 0,
		SLJIT_MEM1(SLJIT_SP), wantedSlot);

	// Every remaining operation is a raw, allocation-free frame transition.
	// No host observer runs until the next body's own publication boundary.
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, top), SLJIT_S5, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, registers));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, frame));
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, returnBase));
	sljit_emit_op2(compiler, SLJIT_SHL, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 3);
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R1, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), exitSlot);
	sljit_emit_op1(compiler, SLJIT_MOV_U16, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), offsetof(NativeBlockExitSite, exitA));
	sljit_emit_op2(compiler, SLJIT_SHL, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 3);
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R2, 0, SLJIT_S0, 0, SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), wantedSlot);
	sljit_emit_op2(compiler, SLJIT_SHL, SLJIT_R0, 0, SLJIT_R1, 0, SLJIT_IMM, 3);
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R0, 0, SLJIT_R3, 0, SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), endSlot, SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), countSlot);
	auto* enoughWanted = sljit_emit_cmp(compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_R1, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_R1, 0);
	sljit_set_label(enoughWanted, sljit_emit_label(compiler));
	auto* noCopy = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
	auto* copy = sljit_emit_label(compiler);
	sljit_emit_fop1(compiler, SLJIT_MOV_F64, SLJIT_FR0, 0, SLJIT_MEM1(SLJIT_R2), 0);
	sljit_emit_fop1(compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_R3), 0, SLJIT_FR0, 0);
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, sizeof(Value));
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, sizeof(Value));
	sljit_emit_op2(compiler, SLJIT_SUB32 | SLJIT_SET_Z, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 1);
	sljit_set_label(sljit_emit_jump(compiler, SLJIT_NOT_ZERO), copy);
	sljit_set_label(noCopy, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), endSlot);
	auto* noFill = sljit_emit_cmp(compiler, SLJIT_GREATER_EQUAL, SLJIT_R3, 0, SLJIT_R1, 0);
	sljit_emit_fset64(compiler, SLJIT_FR0, asNumber(valueNil()));
	auto* fill = sljit_emit_label(compiler);
	sljit_emit_fop1(compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_R3), 0, SLJIT_FR0, 0);
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, sizeof(Value));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_LESS, SLJIT_R3, 0, SLJIT_R1, 0), fill);
	sljit_set_label(noFill, sljit_emit_label(compiler));

	// Retire the exact same owner fields as Thread::leaveFrame. Active roots
	// change only after all returned words have reached the caller's window.
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, frame));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, thread));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), callerSlot);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, stackBase),
		SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, stackCapacity));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R1), thread.stackTop, SLJIT_R3, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R1), thread.currentFrame, SLJIT_R2, 0);
	sljit_emit_op2(compiler, SLJIT_SUB, SLJIT_MEM1(SLJIT_R1), thread.frameDepth,
		SLJIT_MEM1(SLJIT_R1), thread.frameDepth, SLJIT_IMM, 1);
	for (const auto offset : {offsetof(CallFrame, executionImage), offsetof(CallFrame, closure),
		offsetof(CallFrame, decodedPage), offsetof(CallFrame, registers)})
		sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R0), offset, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, decodedPageAddress), SLJIT_IMM, 0);
	for (size_t bank = 0; bank < CARTRIDGE_SLOT_COUNT; ++bank)
		sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R0),
			offsetof(CallFrame, nativeContinuationCells) + bank * sizeof(void*), SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, compilationEntry), SLJIT_IMM, 1);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, protectedContinuationIndex), SLJIT_IMM, -1);
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, isExceptionFrame), SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, isNonMaskableExceptionFrame), SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_S0, 0, SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, registers));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, registers), SLJIT_S0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, frame), SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, registerTop), SLJIT_S5, 0);
	sljit_emit_ijump(compiler, SLJIT_JUMP, SLJIT_S2, 0);

	auto* coldLabel = sljit_emit_label(compiler);
	for (size_t index = 0; index < coldCount; ++index) sljit_set_label(cold[index], coldLabel);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), exitSlot);
	sljit_set_label(sljit_emit_jump(compiler, SLJIT_JUMP), coldDispatch);
	return entry;
}

} // namespace bmsx
