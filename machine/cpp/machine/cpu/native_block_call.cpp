#include "machine/cpu/native_block_abi.h"

#include <bit>

#include "machine/cpu/cpu.h"
#include "machine/cpu/native_execution.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/io.h"

namespace bmsx {

sljit_label* NativeBlockGate::emitCallGate(sljit_compiler* compiler, sljit_label* coldDispatch) {
	const auto thread = Thread::nativeOffsets();
	const auto cpu = CPU::nativeFrameOffsets();
	constexpr sljit_sw pointerShift = std::countr_zero(sizeof(void*));
	constexpr sljit_sw tagOffset = std::endian::native == std::endian::little ? 6 : 0;
	constexpr sljit_sw payloadOffset = sizeof(void*) == 4 && std::endian::native == std::endian::big ? 4 : 0;
	std::array<sljit_jump*, 24> cold;
	size_t coldCount = 0;
	auto* entry = sljit_emit_label(compiler);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, exit), SLJIT_R0, 0);
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_SIG_LESS_EQUAL | SLJIT_32, SLJIT_S4, 0, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, frame));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, caller), SLJIT_R1, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, next));
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, callee), SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U16, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), offsetof(NativeBlockExitSite, exitA));
	sljit_emit_op2(compiler, SLJIT_SHL, SLJIT_R3, 0, SLJIT_R2, 0, SLJIT_IMM, 3);
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R3, 0, SLJIT_S0, 0, SLJIT_R3, 0);
	// Values stay raw words: tag and pointer payload are independent on ARMhf.
	sljit_emit_op1(compiler, SLJIT_MOV_U16, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R3), tagOffset);
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL, SLJIT_R1, 0,
		SLJIT_IMM, valueFromTag(ValueTag::Closure) >> 48);
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_R3, 0, SLJIT_IMM, sizeof(Value));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, args), SLJIT_R1, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R3), payloadOffset);
	if constexpr (sizeof(void*) == 8) sljit_emit_op2(compiler, SLJIT_AND, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, VALUE_PAYLOAD_MASK);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, closure), SLJIT_R3, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_S16, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), offsetof(NativeBlockExitSite, exitB));
	auto* fixedArgs = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_S5, 0, SLJIT_R2, 0);
	sljit_set_label(fixedArgs, sljit_emit_label(compiler));
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
	auto* positiveArgs = sljit_emit_cmp(compiler, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, 0);
	sljit_set_label(positiveArgs, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, argCount), SLJIT_R1, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R3), Closure::nativeFunctionAddressOffset());
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, functionAddress), SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, caller));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, executionImage));

	// Select actual backing descriptors, not a parallel memory map. CALL reads
	// with the latched execution socket; RAM records inherit the ambient image.
	auto* notSystem = sljit_emit_cmp(compiler, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, RAM_BASE);
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32,
		SLJIT_MEM1(SLJIT_R1), Blua32ExecutionImage::nativeExecutionDomainOffset(), SLJIT_IMM, SYSTEM_EXECUTION_DOMAIN_ID);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeCpuRunState, systemRom));
	auto* systemSpan = sljit_emit_jump(compiler, SLJIT_JUMP);
	sljit_set_label(notSystem, sljit_emit_label(compiler));
	auto* cartridge = sljit_emit_cmp(compiler, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, CART_ROM_BASE);
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_LESS | SLJIT_32, SLJIT_R0, 0,
		SLJIT_IMM, IO_BASE + IO_SLOT_COUNT * IO_WORD_SIZE);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeCpuRunState, cpu));
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R2), cpu.activeImage);
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_BASE);
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R2, 0, SLJIT_S3, 0, SLJIT_IMM, offsetof(NativeCpuRunState, ram));
	auto* ramSpan = sljit_emit_jump(compiler, SLJIT_JUMP);
	sljit_set_label(cartridge, sljit_emit_label(compiler));
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_GREATER | SLJIT_32, SLJIT_R0, 0,
		SLJIT_IMM, CART_ROM_BASE + CART_ROM_SIZE - BLUA32_FUNCTION_RECORD_SIZE);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeCpuRunState, cartridgeSlot));
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R3, 0,
		SLJIT_MEM1(SLJIT_R1), Blua32ExecutionImage::nativeExecutionDomainOffset());
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, CART_ROM_BASE);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_S3), offsetof(NativeCpuRunState, cartridgeRom));
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0);
	auto* span = sljit_emit_label(compiler);
	sljit_set_label(systemSpan, span); sljit_set_label(ramSpan, span);
	// Guest offsets cross into host pointer arithmetic only after widening.
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_R0, 0);
	// Offsets are bounded guest addresses, so adding the record width cannot wrap.
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R0, 0, SLJIT_IMM, BLUA32_FUNCTION_RECORD_SIZE);
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_GREATER, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R2), offsetof(Span<const u8>, size_));
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), offsetof(Span<const u8>, data_), SLJIT_R0, 0);
	for (const auto [recordOffset, scratchOffset] : {
		std::pair{BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, offsetof(NativeCallScratch, codeAddress)},
		std::pair{BLUA32_FUNCTION_NUM_PARAMS_OFFSET, offsetof(NativeCallScratch, numParams)},
		std::pair{BLUA32_FUNCTION_MAX_STACK_OFFSET, offsetof(NativeCallScratch, maxStack)},
		std::pair{BLUA32_FUNCTION_FLAGS_OFFSET, offsetof(NativeCallScratch, flags)}}) {
		sljit_emit_mem(compiler, SLJIT_MOV_U32 | SLJIT_MEM_UNALIGNED, SLJIT_R0, SLJIT_MEM1(SLJIT_R2), recordOffset);
		if constexpr (std::endian::native == std::endian::big) sljit_emit_op1(compiler, SLJIT_REV_U32, SLJIT_R0, 0, SLJIT_R0, 0);
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
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_GREATER, SLJIT_R3, 0,
		SLJIT_MEM1(SLJIT_R1), thread.stackCapacity);
	sljit_emit_op2(compiler, SLJIT_SUB, SLJIT_R2, 0,
		SLJIT_MEM1(SLJIT_R1), thread.stackCapacity, SLJIT_R3, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0,
		SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, maxStack));
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_GREATER, SLJIT_R0, 0, SLJIT_R2, 0);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, stackTop), SLJIT_R3, 0);

	// Resolve the fresh record's code address through the live publication table.
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, codeAddress));
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R2, 0, SLJIT_R0, 0, SLJIT_IMM, INSTRUCTION_BYTES - 1u);
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0);
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
	cold[coldCount++] = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_S2, 0, SLJIT_IMM, 0);

	// No observer or allocation occurs beyond admission. Only missing
	// parameters are initialized; ordinary fixed arguments already alias R0.
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, caller));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, top), SLJIT_S5, 0);
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
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, stackBase));
	sljit_emit_op2(compiler, SLJIT_SHL, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 3);
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_S0, 0, SLJIT_MEM1(SLJIT_R0), thread.stack, SLJIT_R1, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, registers), SLJIT_S0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, numParams));
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, argCount));
	auto* argsFit = sljit_emit_cmp(compiler, SLJIT_LESS_EQUAL, SLJIT_R0, 0, SLJIT_R1, 0);
	sljit_emit_op1(compiler, SLJIT_MOV, SLJIT_R0, 0, SLJIT_R1, 0);
	sljit_set_label(argsFit, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, args));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_S0, 0);
	sljit_emit_fset64(compiler, SLJIT_FR1, asNumber(valueNil()));
	auto* fixedArguments = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_R3, 0);
	auto* noCopy = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, 0);
	auto* copy = sljit_emit_label(compiler);
	sljit_emit_fop1(compiler, SLJIT_MOV_F64, SLJIT_FR0, 0, SLJIT_MEM1(SLJIT_R2), 0);
	sljit_emit_fop1(compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_R3), 0, SLJIT_FR0, 0);
	sljit_emit_fop1(compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_R2), 0, SLJIT_FR1, 0);
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, sizeof(Value));
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, sizeof(Value));
	sljit_emit_op2(compiler, SLJIT_SUB | SLJIT_SET_Z, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 1);
	sljit_set_label(sljit_emit_jump(compiler, SLJIT_NOT_ZERO), copy);
	auto* copied = sljit_emit_jump(compiler, SLJIT_JUMP);
	sljit_set_label(fixedArguments, sljit_emit_label(compiler));
	sljit_emit_op2(compiler, SLJIT_SHL, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 3);
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R0, 0);
	auto* fillStart = sljit_emit_label(compiler);
	sljit_set_label(noCopy, fillStart); sljit_set_label(copied, fillStart);
	sljit_emit_op2(compiler, SLJIT_SHL, SLJIT_R0, 0, SLJIT_R1, 0, SLJIT_IMM, 3);
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R0, 0, SLJIT_S0, 0, SLJIT_R0, 0);
	auto* noFill = sljit_emit_cmp(compiler, SLJIT_GREATER_EQUAL, SLJIT_R3, 0, SLJIT_R0, 0);
	auto* fill = sljit_emit_label(compiler);
	sljit_emit_fop1(compiler, SLJIT_MOV_F64, SLJIT_MEM1(SLJIT_R3), 0, SLJIT_FR1, 0);
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, sizeof(Value));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_LESS, SLJIT_R3, 0, SLJIT_R0, 0), fill);
	sljit_set_label(noFill, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, callee));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, thread));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, stackTop));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R1), thread.stackTop, SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R1), thread.currentFrame, SLJIT_R2, 0);
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_MEM1(SLJIT_R1), thread.frameDepth, SLJIT_MEM1(SLJIT_R1), thread.frameDepth, SLJIT_IMM, 1);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_S5, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, numParams));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, registers), SLJIT_S0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, frame), SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_S3), offsetof(NativeBlockRunState, registerTop), SLJIT_S5, 0);
	sljit_emit_ijump(compiler, SLJIT_JUMP, SLJIT_S2, 0);

	auto* coldLabel = sljit_emit_label(compiler);
	for (size_t index = 0; index < coldCount; ++index) sljit_set_label(cold[index], coldLabel);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, exit));
	sljit_set_label(sljit_emit_jump(compiler, SLJIT_JUMP), coldDispatch);
	return entry;
}

} // namespace bmsx
