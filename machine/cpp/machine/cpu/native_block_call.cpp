#include "machine/cpu/native_block_abi.h"

#include <bit>

#include "machine/cpu/cpu.h"
#include "machine/cpu/heap_allocator.h"
#include "machine/cpu/native_execution.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/io.h"

namespace bmsx {

sljit_label* NativeBlockGate::emitCallGate(sljit_compiler* compiler, sljit_label* coldDispatch, sljit_label* returnToCpp) {
	const auto thread = Thread::nativeOffsets();
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
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, thread));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R1), thread.record);
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(ThreadField::FrameDepth), SLJIT_IMM, THREAD_CONTROL_COUNT_MASK);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, frameDepth), SLJIT_R3, 0);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R3, 0,
		SLJIT_MEM1(SLJIT_R1), thread.frameCapacity), coldDispatch);
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R3, 0, SLJIT_MEM2(NativeBlockAbi::words, SLJIT_R2), 2);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, heap));
	sljit_emit_op2(compiler, SLJIT_AND, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, GC_RECORD_MASK);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, closureAddress), SLJIT_R3, 0);
	// The allocator index and RAM header, not a host attachment, admit a closure.
	// Match HeapAllocator::issuedObjectStart even for reduced test RAM geometries.
	constexpr u32 pageShift = std::countr_zero(HEAP_PAGE_SIZE);
	constexpr u32 maxPages = (MAIN_RAM_SIZE - RUNTIME_MANAGEMENT_SIZE) >> pageShift;
	static_assert((1u << HEAP_SLOT_RECIPROCAL_BITS) > HEAP_PAGE_SIZE);
	static_assert(sizeof(HEAP_CLASS_BYTES[0]) == sizeof(HEAP_CLASS_SLOT_RECIPROCALS[0]));
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R1, 0,
		SLJIT_MEM1(SLJIT_R1), GcHeap::nativeControlOffset(), SLJIT_IMM, HEAP_GC_CONTROL_OFFSET);
	sljit_emit_op2(compiler, SLJIT_LSHR32, SLJIT_R2, 0, SLJIT_R1, 0, SLJIT_IMM, pageShift);
	auto* pageLimitFits = sljit_emit_cmp(compiler, SLJIT_LESS_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, maxPages);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_IMM, maxPages);
	sljit_set_label(pageLimitFits, sljit_emit_label(compiler));
	sljit_emit_op2(compiler, SLJIT_LSHR32, SLJIT_R0, 0, SLJIT_R3, 0, SLJIT_IMM, pageShift);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_R2, 0), coldDispatch);
	sljit_emit_op2(compiler, SLJIT_MUL32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, HEAP_PAGE_ENTRY_BYTES);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_R0, 0);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, HEAP_PAGE_ENTRIES);
	NativeBlockAbi::emitRamAddress(compiler, SLJIT_R1, SLJIT_R1);
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R1), 0);
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R2, 0, SLJIT_R0, 0, SLJIT_IMM, 0xffu);
	auto* objectRun = sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, ObjectRun);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, ObjectSlots), coldDispatch);
	sljit_emit_op2(compiler, SLJIT_LSHR32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 8u);
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 0xffu);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R0, 0,
		SLJIT_IMM, HEAP_CLASS_BYTES.size()), coldDispatch);
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R1), 8u, SLJIT_IMM, HEAP_PAGE_LINK_MASK);
	sljit_emit_op2(compiler, SLJIT_SHL32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, HEAP_BUMP_SHIFT);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(HEAP_CLASS_BYTES.data()));
	sljit_emit_op1(compiler, SLJIT_MOV_U16, SLJIT_R2, 0, SLJIT_MEM2(SLJIT_R1, SLJIT_R0), 1);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_IMM, reinterpret_cast<sljit_sw>(HEAP_CLASS_SLOT_RECIPROCALS.data()));
	sljit_emit_op1(compiler, SLJIT_MOV_U16, SLJIT_R0, 0, SLJIT_MEM2(SLJIT_R1, SLJIT_R0), 1);
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R1, 0,
		SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, closureAddress), SLJIT_IMM, HEAP_PAGE_SIZE - 1u);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_R2, 0);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_GREATER | SLJIT_32, SLJIT_R1, 0, SLJIT_R3, 0), coldDispatch);
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_R2, 0);
	sljit_emit_op2(compiler, SLJIT_MUL32, SLJIT_R0, 0, SLJIT_R1, 0, SLJIT_R0, 0);
	sljit_emit_op2(compiler, SLJIT_LSHR32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, HEAP_SLOT_RECIPROCAL_BITS);
	sljit_emit_op2(compiler, SLJIT_MUL32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_R2, 0);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_R1, 0), coldDispatch);
	auto* issuedSlot = sljit_emit_jump(compiler, SLJIT_JUMP);
	sljit_set_label(objectRun, sljit_emit_label(compiler));
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R0, 0,
		SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, closureAddress), SLJIT_IMM, HEAP_PAGE_SIZE - 1u);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0), coldDispatch);
	sljit_set_label(issuedSlot, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, closureAddress));
	NativeBlockAbi::emitRamAddress(compiler, SLJIT_R3, SLJIT_R3);
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R3), 0);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0,
		SLJIT_IMM, static_cast<u8>(ValueTag::Closure)), coldDispatch);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, exit));
	sljit_emit_op1(compiler, SLJIT_MOV_U16, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), offsetof(NativeBlockExitSite, exitA));
	sljit_emit_op1(compiler, SLJIT_MOV_S16, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), offsetof(NativeBlockExitSite, exitB));
	auto* fixedArgs = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, registerTop), SLJIT_R2, 0);
	sljit_set_label(fixedArgs, sljit_emit_label(compiler));
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
	auto* positiveArgs = sljit_emit_cmp(compiler, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, 0);
	sljit_set_label(positiveArgs, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, argCount), SLJIT_R1, 0);
	// The admitted raw Closure carries its callable binding in RAM.
	// Read the saved bank, not the ordinary data-bus SELECT input.
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, closureAddress));
	NativeBlockAbi::emitRamAddress(compiler, SLJIT_R3, SLJIT_R3);
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R3), CLOSURE_BINDING_FLAGS);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, flags), SLJIT_R1, 0);
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, CLOSURE_BINDING_DOMAIN_MASK);
	auto* firstBank = sljit_emit_cmp(compiler, SLJIT_LESS | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 2);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, 2);
	sljit_set_label(firstBank, sljit_emit_label(compiler));
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, caller));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, executionImage));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0,
		SLJIT_MEM1(SLJIT_R0), Blua32ExecutionImage::nativeExecutionDomainOffset()), coldDispatch);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, closureAddress),
		SLJIT_IMM, CLOSURE_PROTOTYPE_ADDRESS);
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	NativeBlockAbi::emitRamAddress(compiler, SLJIT_R0, SLJIT_R0);
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, functionAddress), SLJIT_R0, 0);
	sljit_emit_op2u(compiler, SLJIT_AND32 | SLJIT_SET_Z,
		SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, flags), SLJIT_IMM, CLOSURE_LATCHED_PROTOTYPE);
	auto* latched = sljit_emit_jump(compiler, SLJIT_NOT_ZERO);

	auto* system = sljit_emit_cmp(compiler, SLJIT_LESS | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, RAM_BASE);
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R0, 0, SLJIT_IMM, CART_ROM_BASE);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_GREATER | SLJIT_32, SLJIT_R1, 0,
		SLJIT_IMM, CART_ROM_SIZE - BLUA32_FUNCTION_RECORD_SIZE), coldDispatch);
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R2, 0,
		SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, flags), SLJIT_IMM, CLOSURE_BINDING_DOMAIN_MASK);
	auto* firstSocket = sljit_emit_cmp(compiler, SLJIT_LESS | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 2);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeCpuRunState, cartridgeRoms) + sizeof(void*));
	auto* socketReady = sljit_emit_jump(compiler, SLJIT_JUMP);
	sljit_set_label(firstSocket, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeCpuRunState, cartridgeRoms));
	sljit_set_label(socketReady, sljit_emit_label(compiler));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0), coldDispatch);
	auto* romReady = sljit_emit_jump(compiler, SLJIT_JUMP);
	sljit_set_label(system, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeCpuRunState, systemRom));
	sljit_set_label(romReady, sljit_emit_label(compiler));
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R0, 0, SLJIT_R1, 0, SLJIT_IMM, BLUA32_FUNCTION_RECORD_SIZE);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_GREATER, SLJIT_R0, 0,
		SLJIT_MEM1(SLJIT_R2), offsetof(Span<const u8>, size_)), coldDispatch);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R2), offsetof(Span<const u8>, data_));
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R1, 0);
	for (const auto [field, scratch] : {
		std::pair{BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, offsetof(NativeCallScratch, codeAddress)},
		std::pair{BLUA32_FUNCTION_NUM_PARAMS_OFFSET, offsetof(NativeCallScratch, numParams)},
		std::pair{BLUA32_FUNCTION_MAX_STACK_OFFSET, offsetof(NativeCallScratch, maxStack)},
		std::pair{BLUA32_FUNCTION_FLAGS_OFFSET, offsetof(NativeCallScratch, flags)}}) {
		sljit_emit_mem(compiler, SLJIT_MOV32 | SLJIT_MEM_UNALIGNED, SLJIT_R0, SLJIT_MEM1(SLJIT_R3), field);
		sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), scratch, SLJIT_R0, 0);
	}
	auto* bindingReady = sljit_emit_jump(compiler, SLJIT_JUMP);

	sljit_set_label(latched, sljit_emit_label(compiler));
	// Capture count shares +4 with the collector link; the tail starts after U refs.
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R3), CLOSURE_COUNT_HIGH_BYTE);
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 0x7f);
	sljit_emit_op2(compiler, SLJIT_SHL32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, CLOSURE_COUNT_LOW_BITS);
	sljit_emit_op2(compiler, SLJIT_LSHR32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), GC_RECORD_LINK, SLJIT_IMM, GC_GRAY_INDEX_BITS);
	sljit_emit_op2(compiler, SLJIT_OR32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_R2, 0);
	sljit_emit_op2(compiler, SLJIT_SHL32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 2);
	sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0,
		SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, closureAddress));
	for (const auto [field, scratch] : {
		std::pair{0u, offsetof(NativeCallScratch, codeAddress)},
		std::pair{4u, offsetof(NativeCallScratch, numParams)},
		std::pair{8u, offsetof(NativeCallScratch, maxStack)},
		std::pair{12u, offsetof(NativeCallScratch, flags)}}) {
		sljit_emit_op2(compiler, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_R1, 0, SLJIT_IMM, CLOSURE_CAPTURE_WORDS + field);
		sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
		NativeBlockAbi::emitRamAddress(compiler, SLJIT_R2, SLJIT_R2);
		sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2), 0);
		sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), scratch, SLJIT_R0, 0);
	}
	sljit_set_label(bindingReady, sljit_emit_label(compiler));

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
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, nativeControl));
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(FrameField::StackBase), SLJIT_IMM, FRAME_WINDOW_MASK);
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
	// CALL can enter the depth of a retained IRQ wait just as RET can.
	// Decline before placement: the semantic CALL commits the new frame and
	// stops at its entry with the unused part of the grant intact.
	const auto cpu = CPU::nativeFrameOffsets();
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeCpuRunState, cpu));
	auto* differentThread = sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_MEM1(SLJIT_R1), thread.address,
		SLJIT_MEM1(SLJIT_R0), cpu.haltedThreadAddress);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, frameDepth));
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), cpu.haltedDepth), coldDispatch);
	sljit_set_label(differentThread, sljit_emit_label(compiler));
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
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, compilationEntry), SLJIT_IMM, 1);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, exit));
	for (size_t bank = 0; bank < CARTRIDGE_SLOT_COUNT; ++bank) {
		sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1),
			offsetof(NativeBlockExitSite, continuationCells) + bank * sizeof(void*));
		sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R0),
			offsetof(CallFrame, nativeContinuationCells) + bank * sizeof(void*), SLJIT_R2, 0);
	}
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, nativeControl));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, registerTop));
	emitPublishFrameTop(compiler, SLJIT_R3, SLJIT_R2, SLJIT_R0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), offsetof(NativeBlockExitSite, nextPc));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(FrameField::Pc), SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, caller));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, nativeContinuationPc), SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, callee));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, nativeControl));
	sljit_emit_op2(compiler, SLJIT_SUB32, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(FrameField::CallSite), SLJIT_R2, 0, SLJIT_IMM, INSTRUCTION_BYTES);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(FrameField::OpenHead), SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(FrameField::Protected), SLJIT_IMM, -1);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(FrameField::Flags),
		SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeCpuRunState, frameBank));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, functionAddress));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(FrameField::Function), SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, codeAddress));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(FrameField::Pc), SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U16, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), offsetof(NativeBlockExitSite, exitA));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(FrameField::ReturnBase), SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_S16, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), offsetof(NativeBlockExitSite, exitC));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(FrameField::ReturnCount), SLJIT_R2, 0);
	for (const auto [scratchOffset, field] : {
		std::pair{offsetof(NativeCallScratch, varargBase), FrameField::VarargBase},
		std::pair{offsetof(NativeCallScratch, varargCount), FrameField::VarargCount},
		std::pair{offsetof(NativeCallScratch, numParams), FrameField::Top},
		std::pair{offsetof(NativeCallScratch, stackBase), FrameField::StackBase},
		std::pair{offsetof(NativeCallScratch, maxStack), FrameField::StackCapacity}}) {
		sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), scratchOffset);
		sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(field), SLJIT_R2, 0);
	}
	sljit_emit_op2(compiler, SLJIT_OR32, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(FrameField::Closure),
		SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, closureAddress), SLJIT_IMM, RAM_BASE);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, caller));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, executionImage));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, executionImage), SLJIT_R1, 0);
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
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, registers) + ValueSpan::ramOffset());
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, registers) + ValueSpan::ramOffset(), SLJIT_R2, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, registers) + ValueSpan::mirroredOffset(), SLJIT_IMM, 0);
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
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R1), thread.record);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(ThreadField::StackTop), SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), offsetof(NativeCallScratch, frameDepth));
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(ThreadField::FrameDepth), SLJIT_R0, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R1), thread.currentFrame, SLJIT_R2, 0);
	emitFrameEntry(compiler, offsetof(NativeCallScratch, target));

	// The stable gate has already published CALL's exact prefix. A completed
	// leaf owns its receiving range even when that prefix exhausted the grant.
	sljit_set_label(builtin, sljit_emit_label(compiler));
	sljit_emit_op1(compiler, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM2(NativeBlockAbi::words, SLJIT_R2), 2);
	sljit_set_label(NativeBlockAbi::emitNonleafBuiltinJump(compiler, SLJIT_R1), coldDispatch);
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
