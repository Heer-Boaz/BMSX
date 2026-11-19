#include "machine/cpu/native_block_compiler.h"
#include "machine/cpu/execution_image.h"
#include "machine/cpu/native_value_emit.h"
#include "machine/cpu/call_state.h"
#include "machine/cpu/upvalue.h"
#include "machine/cpu/thread.h"

#include <bit>

namespace bmsx {
void NativeBlockCompiler::emitContext(const DecodedInstruction& instruction, NativeBlockExitSite* watched) {
	auto* c = m_compiler;
	const auto op = static_cast<OpCode>(instruction.op);
	const auto bank = op == OpCode::GETSYS || op == OpCode::SETSYS ? offsetof(NativeBlockRunState, systemGlobalValues)
		: offsetof(NativeBlockRunState, globalValues);
	const sljit_sw words = bank + ValueSpan::wordsOffset(), tags = bank + ValueSpan::tagsOffset();
	const sljit_sw wordOffset = instruction.bx * sizeof(u32), tagOffset = instruction.bx;
	if (watched) {
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
		emitRawLoad(instruction.a, SLJIT_R0, SLJIT_R1);
		if constexpr (std::endian::native == std::endian::big)
			sljit_emit_op1(c, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), wordOffset, SLJIT_R0, 0);
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(NativeBlockAbi::state), tags);
		sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R3), tagOffset, SLJIT_R1, 0);
		return;
	}
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state), words);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2), wordOffset);
	if constexpr (std::endian::native == std::endian::big)
		sljit_emit_op1(c, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state), tags);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R2), tagOffset);
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
	if constexpr (std::endian::native == std::endian::big) {
		auto* hostPool = sljit_emit_cmp(m_compiler, SLJIT_EQUAL, SLJIT_MEM1(NativeBlockAbi::state),
			offsetof(NativeBlockRunState, constants) + ConstValueSpan::ramOffset(), SLJIT_IMM, 0);
		sljit_emit_op1(m_compiler, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
		sljit_set_label(hostPool, sljit_emit_label(m_compiler));
	}
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(NativeBlockAbi::state),
		offsetof(NativeBlockRunState, constants) + ConstValueSpan::tagsOffset());
	sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM2(SLJIT_R1, SLJIT_R2), 0);
	emitRawStore(instruction.a, SLJIT_R0, SLJIT_R1);
}

void NativeBlockCompiler::emitUpvalue(const DecodedInstruction& instruction, NativeBlockExitSite* openWrite) {
	sljit_emit_op1(
		m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, frame));
	sljit_emit_op1(m_compiler, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, nativeControl));
	sljit_emit_op2(m_compiler, SLJIT_ADD32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), static_cast<u32>(FrameField::Closure),
		SLJIT_IMM, CLOSURE_CAPTURE_WORDS + instruction.b * sizeof(u32));
	sljit_emit_op2(m_compiler, SLJIT_AND, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	NativeBlockAbi::emitRamAddress(m_compiler, SLJIT_R2, SLJIT_R2);
	sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	if constexpr (std::endian::native == std::endian::big)
		sljit_emit_op1(m_compiler, SLJIT_REV32, SLJIT_R2, 0, SLJIT_R2, 0);
	auto* c = m_compiler;
	sljit_emit_op2(c, SLJIT_AND, SLJIT_R3, 0, SLJIT_R2, 0, SLJIT_IMM, UPVALUE_ADDRESS_MASK);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R2, SLJIT_R3);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2), UPVALUE_FLAGS);
	sljit_emit_op2(c, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, UPVALUE_OPEN);
	auto* open = sljit_emit_cmp(c, SLJIT_NOT_EQUAL, SLJIT_R0, 0, SLJIT_IMM, 0);
	if (instruction.op == static_cast<u8>(OpCode::SETUP)) {
		fault(open, *openWrite, m_cache.state());
		// Both value lanes are in the aligned cell's write-watch group.
		emitRamWordWriteWatch(*openWrite, SLJIT_R3, 0, SLJIT_R0, SLJIT_R1, 3u);
		sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2), GC_COLOR_OFFSET);
		sljit_emit_op2(c, SLJIT_AND32, SLJIT_R1, 0, SLJIT_R0, 0, SLJIT_IMM, GC_OLD | GC_REMEMBERED);
		fault(sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, GC_OLD), *openWrite, m_cache.state());
		sljit_emit_op2(c, SLJIT_AND32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, GC_COLOR_MASK);
		auto* notBlack = sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 3);
		emitGrayChange(*openWrite, SLJIT_R3, 0, SLJIT_R2, SLJIT_R0, SLJIT_R1, UPVALUE_NEXT, 8u);
		sljit_set_label(notBlack, sljit_emit_label(c));
		emitRawLoad(instruction.a, SLJIT_R0, SLJIT_R1);
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
	// The owner and slot are guest words, so a read can alias any active bank.
	m_cache.emitState(m_cache.state());
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
	NativeBlockAbi::emitRamAddress(c, SLJIT_R1, SLJIT_R1);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1), 0);
	sljit_emit_op2(c, SLJIT_SHL32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, 2);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_R3, 0);
	sljit_emit_op2(c, SLJIT_AND, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R0, SLJIT_R0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), 0);
	if constexpr (std::endian::native == std::endian::big)
		sljit_emit_op1(c, SLJIT_REV32, SLJIT_R0, 0, SLJIT_R0, 0);
	sljit_set_label(ready, sljit_emit_label(c));
	emitRawStore(instruction.a, SLJIT_R0, SLJIT_R1);
}

void NativeBlockCompiler::emitVararg(const DecodedInstruction& instruction, NativeBlockExitSite& growth) {
	const bool open = instruction.b == 0;
	const int first = instruction.a, fixed = instruction.b - 1;
	if (fixed == 0) return;
	auto* c = m_compiler;
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, frame));
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, nativeControl));
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(FrameField::VarargCount), SLJIT_IMM, FRAME_WINDOW_MASK);
	if (!open) {
		sljit_emit_op2(c, SLJIT_AND32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(FrameField::StackCapacity), SLJIT_IMM, FRAME_WINDOW_MASK);
		fault(sljit_emit_cmp(c, SLJIT_LESS | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, first + fixed), growth, m_cache.state());
		auto* fits = sljit_emit_cmp(c, SLJIT_LESS_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, fixed);
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_IMM, fixed);
		sljit_set_label(fits, sljit_emit_label(c));
	}
	// The forward bulk path uses a disjoint source below this frame. A
	// changed descriptor can alias cached registers or the RAM mirror.
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(FrameField::StackBase), SLJIT_IMM, FRAME_WINDOW_MASK);
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R3), static_cast<u32>(FrameField::VarargBase), SLJIT_IMM, FRAME_WINDOW_MASK);
	sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R1, 0);
	auto* empty = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R3, 0, SLJIT_R2, 0);
	fault(sljit_emit_cmp(c, SLJIT_SIG_GREATER | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0), growth, m_cache.state());
	if (open) {
		sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R2, 0, SLJIT_IMM, first);
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), offsetof(CallFrame, nativeControl));
		sljit_emit_op2(c, SLJIT_AND32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), static_cast<u32>(FrameField::StackCapacity), SLJIT_IMM, FRAME_WINDOW_MASK);
		fault(sljit_emit_cmp(c, SLJIT_GREATER | SLJIT_32, SLJIT_R1, 0, SLJIT_R0, 0), growth, m_cache.state());
		auto* extent = sljit_emit_jump(c, SLJIT_JUMP);
		sljit_set_label(empty, sljit_emit_label(c));
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, first);
		sljit_set_label(extent, sljit_emit_label(c));
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeBlockRunState, registerTop), SLJIT_R1, 0);
		sljit_emit_op2(c, SLJIT_SUB32, NativeBlockAbi::budget, 0, NativeBlockAbi::budget, 0, SLJIT_R2, 0);
		// The runtime extent can be zero. Dirty slots outside it must survive.
		m_cache.publishRange(first, std::numeric_limits<int>::max());
		m_cache.discardRange(first, std::numeric_limits<int>::max());
	} else {
		sljit_set_label(empty, sljit_emit_label(c));
		m_cache.discardRange(first, first + fixed);
	}
	sljit_emit_op1(c, SLJIT_MOV_S32, SLJIT_R0, 0, SLJIT_R3, 0);
	sljit_emit_op1(c, SLJIT_MOV, SLJIT_R1, 0, SLJIT_IMM, first);
	if (!open)
		sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R3, 0, SLJIT_IMM, fixed, SLJIT_R2, 0);
	NativeBlockAbi::emitFramePlacement(c, false, !open);
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
