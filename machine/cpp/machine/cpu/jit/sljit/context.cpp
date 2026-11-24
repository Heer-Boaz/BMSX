#include "machine/cpu/jit/sljit/lowering.h"

#include <bit>
#include <limits>

#include "machine/cpu/cpu.h"
#include "machine/cpu/call_state.h"
#include "machine/cpu/upvalue.h"
#include "machine/cpu/thread.h"

namespace bmsx {
void NativeLowering::lowerOperation(const NativeGlobalAccess& access, const NativeInstruction& instruction) {
	auto* watched = sideExit(instruction.slow);
	auto* c = m_compiler;
	const auto bank = access.bank == NativeGlobalBank::System ? offsetof(NativeBlockRunState, systemGlobalValues)
		: offsetof(NativeBlockRunState, globalValues);
	const sljit_sw words = bank + ValueSpan::wordsOffset(), tags = bank + ValueSpan::tagsOffset();
	const sljit_sw wordOffset = access.index * sizeof(u32), tagOffset = access.index;
	if (access.access == NativeAccess::Write) {
		// Neither lane can be written until both have passed admission:
		// either one can invalidate the executing region.
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state), words);
		sljit_emit_op2(c, SLJIT_SUB, SLJIT_R0, 0, SLJIT_R2, 0,
			SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, ram));
		// A register operand carries no displacement: form the slot's RAM offset.
		sljit_emit_op2(c, SLJIT_ADD, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, wordOffset);
		emitRamWordWriteWatch(*watched, SLJIT_R0, 0, SLJIT_R1, SLJIT_R3);
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(NativeBlockAbi::state), tags);
		sljit_emit_op2(c, SLJIT_SUB, SLJIT_R0, 0, SLJIT_R3, 0,
			SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, ram));
		sljit_emit_op2(c, SLJIT_ADD, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, tagOffset);
		emitRamWordWriteWatch(*watched, SLJIT_R0, 0, SLJIT_R1, SLJIT_R3);
		emitRawLoad(access.slot, SLJIT_R0, SLJIT_R1);
		if constexpr (std::endian::native == std::endian::big)
			sljit_emit_op1(c, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), wordOffset, SLJIT_R0, 0);
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(NativeBlockAbi::state), tags);
		sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R3), tagOffset, SLJIT_R1, 0);
		emitStoreBarrier(access.slot, access.barrier, StoreBarrierRecord::Global, *watched);
		return;
	}
	const auto demand = m_uses.nextOperandDemand(m_instruction, access.slot);
	const auto address = m_cache.acquireScratch();
	const auto result = m_cache.writeRaw(access.slot, demand);
	sljit_emit_op1(c, SLJIT_MOV_P, address, 0, SLJIT_MEM1(NativeBlockAbi::state), words);
	constexpr auto loadWord = std::endian::native == std::endian::big ? SLJIT_REV32 : SLJIT_MOV32;
	sljit_emit_op1(c, loadWord, result.word, result.wordOffset, SLJIT_MEM1(address), wordOffset);
	sljit_emit_op1(c, SLJIT_MOV_P, address, 0, SLJIT_MEM1(NativeBlockAbi::state), tags);
	sljit_emit_op1(c, SLJIT_MOV_U8, result.tag, result.tagOffset, SLJIT_MEM1(address), tagOffset);
}
void NativeLowering::lowerOperation(const NativePoolRead& read, const NativeInstruction& instruction) {
	auto& invalid = *sideExit(instruction.slow);
	if (read.indexPlan == NativeWordSource::Invalid) {
		emitLeave(invalid, Charge::Pending);
		return;
	}
	emitWordOperand(read.index, read.indexPlan, invalid);
	sljit_emit_op1(m_compiler, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_R0, 0);
	fault(sljit_emit_cmp(m_compiler, SLJIT_GREATER_EQUAL, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, constants) + ConstValueSpan::sizeOffset()), invalid, m_cache.state());
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, constants) + ConstValueSpan::wordsOffset());
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM2(SLJIT_R1, SLJIT_R2), 2);
	if constexpr (std::endian::native == std::endian::big) {
		auto* hostPool = sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_MEM1(NativeBlockAbi::state),
			offsetof(NativeBlockRunState, constants) + ConstValueSpan::ramOffset(), SLJIT_IMM, 0);
		sljit_emit_op1(m_compiler, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
		sljit_set_label(hostPool, sljit_emit_label(m_compiler));
	}
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, constants) + ConstValueSpan::tagsOffset());
	sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM2(SLJIT_R1, SLJIT_R2), 0);
	emitRawStore(read.result, SLJIT_R0, SLJIT_R1);
}

void NativeLowering::lowerOperation(const NativeUpvalueAccess& access, const NativeInstruction& instruction) {
	auto& slow = *sideExit(instruction.slow);
	auto* c = m_compiler;
	const bool writes = access.access == NativeAccess::Write;
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, closure),
		SLJIT_IMM, ClosureRecord::captureWordAddress(0u, access.capture));
	sljit_emit_op2(c, SLJIT_AND, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R2);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	if constexpr (std::endian::native == std::endian::big)
		sljit_emit_op1(c, SLJIT_REV32, SLJIT_R2, 0, SLJIT_R2, 0);
	sljit_emit_op2(c, SLJIT_AND, SLJIT_R3, 0, SLJIT_R2, 0, SLJIT_IMM, UPVALUE_ADDRESS_MASK);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R3);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2), UPVALUE_FLAGS);
	sljit_emit_op2(c, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, UPVALUE_OPEN);
	auto* open = sljit_emit_cmp(c, SLJIT_NOT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, 0);
	if (writes) {
		fault(open, slow, m_cache.state());
		// Both value lanes are in the aligned cell's write-watch group.
		emitRamWordWriteWatch(slow, SLJIT_R3, 0, SLJIT_R0, SLJIT_R1, 3u);
		emitStoreBarrier(access.slot, access.barrier, StoreBarrierRecord::ClosedUpvalue, slow);
		emitRawLoad(access.slot, SLJIT_R0, SLJIT_R1);
		if constexpr (std::endian::native == std::endian::big)
			sljit_emit_op1(c, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), UPVALUE_VALUE_WORD, SLJIT_R0, 0);
		sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R2), UPVALUE_VALUE_TAG, SLJIT_R1, 0);
		return;
	}
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2), UPVALUE_VALUE_WORD);
	if constexpr (std::endian::native == std::endian::big)
		sljit_emit_op1(c, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R2), UPVALUE_VALUE_TAG);
	auto* ready = sljit_emit_jump(c, SLJIT_JUMP);
	sljit_set_label(open, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R2), UPVALUE_VALUE_WORD);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), UPVALUE_OWNER);
	if constexpr (std::endian::native == std::endian::big) {
		sljit_emit_op1(c, SLJIT_REV32, SLJIT_R3, 0, SLJIT_R3, 0);
		sljit_emit_op1(c, SLJIT_REV32, SLJIT_R2, 0, SLJIT_R2, 0);
	}
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R2, 0, SLJIT_IMM, static_cast<u32>(ThreadField::StackBlock));
	sljit_emit_op2(c, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R0, SLJIT_R0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), 0);
	if constexpr (std::endian::native == std::endian::big)
		sljit_emit_op1(c, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
	sljit_emit_op2(c, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, static_cast<u32>(ThreadField::StackCapacity));
	sljit_emit_op2(c, SLJIT_AND, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R2);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	if constexpr (std::endian::native == std::endian::big)
		sljit_emit_op1(c, SLJIT_REV32, SLJIT_R2, 0, SLJIT_R2, 0);
	sljit_emit_op2(c, SLJIT_SHL32, SLJIT_R1, 0, SLJIT_R2, 0, SLJIT_IMM, 2);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_R3, 0);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_R0, 0);
	sljit_emit_op2(c, SLJIT_AND, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, MAIN_RAM_SIZE - 1u);
	sljit_emit_op2(c, SLJIT_SHL32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, 2);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_R3, 0);
	sljit_emit_op2(c, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	// An open cell can observe the current Thread's cached Value slots.
	m_cache.emitState(m_cache.state());
	NativeBlockAbi::emitRamAddress(c, SLJIT_R1, SLJIT_R1);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1), 0);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R0, SLJIT_R0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), 0);
	if constexpr (std::endian::native == std::endian::big)
		sljit_emit_op1(c, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
	sljit_set_label(ready, sljit_emit_label(c));
	emitRawStore(access.slot, SLJIT_R0, SLJIT_R1);
}

void NativeLowering::lowerOperation(const NativeVararg& placement, const NativeInstruction& instruction) {
	const auto [first, requested] = placement;
	if (requested == 0) return;
	auto& growth = *sideExit(instruction.slow);
	const bool open = requested < 0;
	const int end = open ? std::numeric_limits<int>::max() : first + requested;
	// On a miss these values still belong to the executed prefix. On a
	// successful open copy the runtime may write none or only some of them.
	if (open) m_cache.publishRange(first, end);
	m_cache.spillCall(false, 0, NativeRegisterCache::FrameSlots::MayChange);
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R0, 0, NativeBlockAbi::state, 0);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, first);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_IMM, requested);
	sljit_emit_icall(m_compiler, SLJIT_CALL, SLJIT_ARGS3(32, P, 32, 32),
		SLJIT_IMM, SLJIT_FUNC_ADDR(&CPU::placeNativeVarargs));
	m_cache.spillCall(true, 0, NativeRegisterCache::FrameSlots::MayChange);
	fault(sljit_emit_cmp(m_compiler, SLJIT_SIG_LESS | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0), growth, m_cache.state());
	m_cache.discardRange(first, end);
	// The IR already accounts for fixed placement. Only an open transfer
	// introduces a dynamic charge into the running native grant.
	if (open)
		sljit_emit_op2(m_compiler, SLJIT_SUB32, NativeBlockAbi::budget, 0, NativeBlockAbi::budget, 0, SLJIT_R0, 0);
}

void NativeLowering::lowerOperation(const NativeClearSlots& clear, const NativeInstruction&) {
	const auto [first, count] = clear;
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
