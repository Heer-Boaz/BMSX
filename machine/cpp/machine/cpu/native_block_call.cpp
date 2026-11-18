#include "machine/cpu/native_block_abi.h"

#include <bit>

#include "machine/cpu/cpu.h"
#include "machine/cpu/native_execution.h"
#include "machine/cpu/native_value_emit.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/io.h"

namespace bmsx {

sljit_label* NativeBlockGate::emitCallGate(sljit_compiler* compiler, sljit_label* coldDispatch, sljit_label* returnToCpp) {
	const auto thread = Thread::nativeOffsets();
	const auto function = Closure::nativeFunctionOffsets();
	constexpr sljit_sw pointerShift = std::countr_zero(sizeof(void*));
	auto* entry = sljit_emit_label(compiler);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, exit), SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, frame));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, caller), SLJIT_R1, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U16, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), offsetof(NativeBlockExitSite, exitA));
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM2(NativeBlockAbi::tags, SLJIT_R2), 0);
	auto* builtin = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R1, 0,
		SLJIT_IMM, valueTagHeader(ValueTag::BuiltinFunction));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL, SLJIT_R1, 0,
		SLJIT_IMM, valueTagHeader(ValueTag::Closure)), coldDispatch);
	// Builtins need no child frame. Only the closure path admits a spare node.
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, caller));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, next));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R1, 0, SLJIT_IMM, 0), coldDispatch);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, callee), SLJIT_R1, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R3, 0, SLJIT_MEM2(NativeBlockAbi::words, SLJIT_R2), 2);
#if UINTPTR_MAX != UINT32_MAX
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, heap));
#endif
	emitObjectReference(compiler, SLJIT_R3, SLJIT_R3, SLJIT_R1);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, closure), SLJIT_R3, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_S16, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), offsetof(NativeBlockExitSite, exitB));
	auto* fixedArgs = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, registerTop), SLJIT_R2, 0);
	sljit_set_label(fixedArgs, sljit_emit_label(compiler));
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
	auto* positiveArgs = sljit_emit_cmp(compiler, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, 0);
	sljit_set_label(positiveArgs, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, argCount), SLJIT_R1, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R3), function.address);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, functionAddress), SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, caller));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, executionImage));
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R3), function.executionDomainId);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0,
		SLJIT_MEM1(SLJIT_R1), Blua32ExecutionImage::nativeExecutionDomainOffset()), coldDispatch);
	for (const auto [fieldOffset, scratchOffset] : {
		std::pair{function.codeAddress, offsetof(NativeCallScratch, codeAddress)},
		std::pair{function.numParams, offsetof(NativeCallScratch, numParams)},
		std::pair{function.maxStack, offsetof(NativeCallScratch, maxStack)},
		std::pair{function.flags, offsetof(NativeCallScratch, flags)}}) {
		sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R3), fieldOffset);
		sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), scratchOffset, SLJIT_R0, 0);
	}

	// The argument area is the fixed callee's working frame. Vararg callees
	// slide above all supplied arguments and retain extras in the lower area.
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, maxStack));
	auto* parametersFit = sljit_emit_cmp(compiler, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R0, 0,
		SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, numParams));
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, numParams));
	sljit_set_label(parametersFit, sljit_emit_label(compiler));
	auto* nonemptyStack = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_IMM, 1);
	sljit_set_label(nonemptyStack, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, maxStack), SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, caller));
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, stackBase));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, exit));
	sljit_emit_op1(compiler, SLJIT_MOV_U16, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), offsetof(NativeBlockExitSite, exitA));
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R2, 0);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, argumentBase), SLJIT_R3, 0);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_R3, 0,
		SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, numParams));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, varargBase), SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_IMM, 0);
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, flags), SLJIT_IMM, BLUA32_FUNCTION_VARARG);
	auto* noVarargs = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R3, 0,
		SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, argCount));
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, argCount),
		SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, numParams));
	auto* positiveVarargs = sljit_emit_cmp(compiler, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_IMM, 0);
	auto* varargsReady = sljit_emit_label(compiler);
	sljit_set_label(noVarargs, varargsReady); sljit_set_label(positiveVarargs, varargsReady);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, varargCount), SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, stackBase), SLJIT_R3, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, thread));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_GREATER, SLJIT_R3, 0,
		SLJIT_MEM1(SLJIT_R1), thread.stackCapacity), coldDispatch);
	sljit_emit_op2(compiler, SLJIT_SUB, SLJIT_R2, 0,
		SLJIT_MEM1(SLJIT_R1), thread.stackCapacity, SLJIT_R3, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0,
		SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, maxStack));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_GREATER, SLJIT_R0, 0, SLJIT_R2, 0), coldDispatch);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, stackTop), SLJIT_R3, 0);

	// Resolve the bound record's code address through the live publication table.
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, codeAddress));
	emitCodeLookup(compiler, coldDispatch);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, target), SLJIT_R3, 0);

	// Charge only initialized formal slots. Supplied fixed arguments alias;
	// vararg formals move above the original argument range.
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, numParams));
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, flags), SLJIT_IMM, BLUA32_FUNCTION_VARARG);
	auto* movedParameters = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, argCount));
	auto* missingParameters = sljit_emit_cmp(compiler, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM, 0);
	auto* placementCount = sljit_emit_label(compiler);
	sljit_set_label(movedParameters, placementCount); sljit_set_label(missingParameters, placementCount);
	// A completed CALL
	// may exhaust its grant, but must not then start the callee's first opcode.
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, NativeBlockAbi::budget, 0, SLJIT_R0, 0), coldDispatch);
	sljit_emit_op2(compiler, SLJIT_SUB32, NativeBlockAbi::budget, 0, NativeBlockAbi::budget, 0, SLJIT_R0, 0);

	// No observer or allocation occurs beyond admission.
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, caller));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, top), SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, registerTop));
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, compilationEntry), SLJIT_IMM, 1);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, exit));
	for (size_t bank = 0; bank < CARTRIDGE_SLOT_COUNT; ++bank) {
		sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1),
			offsetof(NativeBlockExitSite, continuationCells) + bank * sizeof(void*));
		sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R0),
			offsetof(CallFrame, nativeContinuationCells) + bank * sizeof(void*), SLJIT_R2, 0);
	}
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), offsetof(NativeBlockExitSite, nextPc));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, pc), SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, callee));
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, callSitePc), SLJIT_R2, 0, SLJIT_IMM, INSTRUCTION_BYTES);
	sljit_emit_op1(compiler, SLJIT_MOV_U16, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), offsetof(NativeBlockExitSite, exitA));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, returnBase), SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_S16, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), offsetof(NativeBlockExitSite, exitC));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, returnCount), SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, returnToCompletionLatch), SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, executionImage));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, executionImage), SLJIT_R1, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, closure));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, closure), SLJIT_R1, 0);
	for (const auto [scratchOffset, frameOffset] : {
		std::pair{offsetof(NativeCallScratch, functionAddress), offsetof(CallFrame, functionAddress)},
		std::pair{offsetof(NativeCallScratch, codeAddress), offsetof(CallFrame, pc)},
		std::pair{offsetof(NativeCallScratch, varargBase), offsetof(CallFrame, varargBase)},
		std::pair{offsetof(NativeCallScratch, varargCount), offsetof(CallFrame, varargCount)},
		std::pair{offsetof(NativeCallScratch, stackBase), offsetof(CallFrame, stackBase)},
		std::pair{offsetof(NativeCallScratch, maxStack), offsetof(CallFrame, stackCapacity)},
		std::pair{offsetof(NativeCallScratch, numParams), offsetof(CallFrame, top)}}) {
		sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), scratchOffset);
		sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R3), frameOffset, SLJIT_R1, 0);
	}
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, thread));
	sljit_emit_op1(compiler, SLJIT_MOV_P, NativeBlockAbi::words, 0, SLJIT_MEM1(SLJIT_R0), thread.stackWords);
	sljit_emit_op1(compiler, SLJIT_MOV_P, NativeBlockAbi::tags, 0, SLJIT_MEM1(SLJIT_R0), thread.stackTags);
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, stackBase));
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, registers) + ValueSpan::tagsOffset(),
		NativeBlockAbi::tags, 0, SLJIT_R1, 0);
	sljit_emit_op2(compiler, SLJIT_SHL, SLJIT_R2, 0, SLJIT_R1, 0, SLJIT_IMM, 2);
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, registers) + ValueSpan::wordsOffset(),
		NativeBlockAbi::words, 0, SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, maxStack));
	sljit_emit_op1(compiler, SLJIT_MOV, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, registers) + ValueSpan::sizeOffset(), SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, argumentBase));
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, argCount));
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, numParams));
	auto* argsFit = sljit_emit_cmp(compiler, SLJIT_LESS_EQUAL, SLJIT_R2, 0, SLJIT_R3, 0);
	sljit_emit_op1(compiler, SLJIT_MOV, SLJIT_R2, 0, SLJIT_R3, 0);
	sljit_set_label(argsFit, sljit_emit_label(compiler));
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R2, 0);
	NativeBlockAbi::emitFramePlacement(compiler, true, true);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, callee));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, thread));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, stackTop));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R1), thread.stackTop, SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R1), thread.currentFrame, SLJIT_R2, 0);
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_MEM1(SLJIT_R1), thread.frameDepth, SLJIT_MEM1(SLJIT_R1), thread.frameDepth, SLJIT_IMM, 1);
	emitFrameEntry(compiler, offsetof(NativeCallScratch, target));

	// The stable gate has already published CALL's exact prefix. A completed
	// leaf owns its receiving range even when that prefix exhausted the grant.
	sljit_set_label(builtin, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, NativeBlockAbi::state, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, exit));
	sljit_emit_icall(compiler, SLJIT_CALL, SLJIT_ARGS2(32, P, P),
		SLJIT_IMM, SLJIT_FUNC_ADDR(&CPU::tryRunNativeBuiltinLeaf));
	auto* declinedBuiltin = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0,
		SLJIT_IMM, static_cast<u32>(NativeBuiltinCallOutcome::Declined));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0,
		SLJIT_IMM, static_cast<u32>(NativeBuiltinCallOutcome::CompletedStop)), returnToCpp);
	sljit_emit_op1(compiler, SLJIT_MOV32, NativeBlockAbi::budget, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, remainingCycles));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, exit));
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeCpuRunState, cartridgeSlot));
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R0, 0, SLJIT_R0, 0,
		SLJIT_IMM, offsetof(NativeBlockExitSite, continuationCells));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM2(SLJIT_R0, SLJIT_R1), pointerShift);
	sljit_emit_ijump(compiler, SLJIT_JUMP, SLJIT_MEM1(SLJIT_R0), 0);

	sljit_set_label(declinedBuiltin, coldDispatch);
	return entry;
}

} // namespace bmsx
