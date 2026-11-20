#include "machine/cpu/native_block_abi.h"
#include <bit>
#include "machine/cpu/call_state.h"
#include "machine/cpu/native_execution.h"

namespace bmsx {

void NativeBlockGate::emitCodeLookup(sljit_compiler* compiler, sljit_label* coldDispatch) {
	constexpr sljit_sw pointerShift = std::countr_zero(sizeof(void*));
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_R2, 0, SLJIT_R0, 0, SLJIT_IMM, INSTRUCTION_BYTES - 1u);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0), coldDispatch);
	sljit_emit_op2(compiler, SLJIT_LSHR, SLJIT_R2, 0, SLJIT_R0, 0, SLJIT_IMM, NativeCodeLookup::ROOT_SHIFT);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(NativeBlockAbi::state), offsetof(NativeCpuRunState, codeRoot));
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM2(SLJIT_R3, SLJIT_R2), pointerShift);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R3, 0, SLJIT_IMM, 0), coldDispatch);
	sljit_emit_op2(compiler, SLJIT_LSHR, SLJIT_R2, 0, SLJIT_R0, 0, SLJIT_IMM, MAPPED_PAGE_BYTE_SHIFT);
	sljit_emit_op2(compiler, SLJIT_AND, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, NativeCodeLookup::GROUP_PAGES - 1u);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM2(SLJIT_R3, SLJIT_R2), pointerShift);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R3, 0, SLJIT_IMM, 0), coldDispatch);
	static_assert(offsetof(NativeCodeLookup::DispatchPage, code) == 0);
	sljit_emit_op2(compiler, SLJIT_AND, SLJIT_R2, 0, SLJIT_R0, 0, SLJIT_IMM, MAPPED_PAGE_BYTE_MASK);
	sljit_emit_op2(compiler, SLJIT_LSHR, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 2);
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM2(SLJIT_R3, SLJIT_R2), pointerShift);
	sljit_set_label(sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R3, 0, SLJIT_IMM, 0), coldDispatch);
}

void NativeBlockAbi::emitFramePlacement(sljit_compiler* compiler, bool moveFormals, bool pad) {
	// Both spans belong to one thread. Fixed arguments already occupy the
	// destination; moved vararg formals are disjoint. Ordinary return values
	// move downward; saved varargs end before the register window.
	sljit_jump* aliased = moveFormals ? sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R0, 0, SLJIT_R1, 0) : nullptr;
	auto* empty = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0);
	auto* copy = sljit_emit_label(compiler);
	for (auto [plane, shift] : {std::pair{NativeBlockAbi::words, 2}, std::pair{NativeBlockAbi::tags, 0}}) {
		const int op = shift ? SLJIT_MOV32 : SLJIT_MOV_U8;
		sljit_emit_op1(compiler, op, SLJIT_MEM2(plane, SLJIT_R1), shift, SLJIT_MEM2(plane, SLJIT_R0), shift);
		if (moveFormals)
			sljit_emit_op1(compiler, op, SLJIT_MEM2(plane, SLJIT_R0), shift, SLJIT_IMM, 0);
	}
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 1);
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
	sljit_emit_op2(compiler, SLJIT_SUB32 | SLJIT_SET_Z, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 1);
	sljit_set_label(sljit_emit_jump(compiler, SLJIT_NOT_ZERO), copy);
	if (aliased) {
		sljit_set_label(aliased, sljit_emit_label(compiler));
		// After a move R2 is zero; after aliasing it still counts supplied slots.
		sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_R2, 0);
	}
	sljit_set_label(empty, sljit_emit_label(compiler));
	if (!pad) return;
	auto* full = sljit_emit_cmp(compiler, SLJIT_EQUAL, SLJIT_R3, 0, SLJIT_IMM, 0);
	auto* fill = sljit_emit_label(compiler);
	static_assert(valueNil() == 0);
	sljit_emit_op1(compiler, SLJIT_MOV32, SLJIT_MEM2(NativeBlockAbi::words, SLJIT_R1), 2, SLJIT_IMM, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_U8, SLJIT_MEM2(NativeBlockAbi::tags, SLJIT_R1), 0, SLJIT_IMM, 0);
	sljit_emit_op2(compiler, SLJIT_ADD, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
	sljit_emit_op2(compiler, SLJIT_SUB32 | SLJIT_SET_Z, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
	sljit_set_label(sljit_emit_jump(compiler, SLJIT_NOT_ZERO), fill);
	sljit_set_label(full, sljit_emit_label(compiler));
}

void NativeBlockGate::emitPublishFrameTop(sljit_compiler* compiler, sljit_s32 control, sljit_s32 top, sljit_s32 scratch) {
	const auto offset = static_cast<u32>(FrameField::Top);
	sljit_emit_op2(compiler, SLJIT_AND32, scratch, 0, SLJIT_MEM1(control), offset, SLJIT_IMM, ~FRAME_WINDOW_MASK);
	sljit_emit_op2(compiler, SLJIT_OR32, SLJIT_MEM1(control), offset, scratch, 0, top, 0);
}

void NativeBlockGate::emitFrameEntry(sljit_compiler* compiler, sljit_s32 frame, sljit_s32 target) {
	constexpr auto state = NativeBlockAbi::state;
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_MEM1(state), offsetof(NativeBlockRunState, frame), frame, 0);
	sljit_emit_op1(compiler, SLJIT_MOV_P, NativeBlockAbi::words, 0, SLJIT_MEM1(frame), offsetof(CallFrame, registers) + ValueSpan::wordsOffset());
	sljit_emit_op1(compiler, SLJIT_MOV_P, NativeBlockAbi::tags, 0, SLJIT_MEM1(frame), offsetof(CallFrame, registers) + ValueSpan::tagsOffset());
	sljit_emit_op1(compiler, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(frame), offsetof(CallFrame, nativeControl));
	sljit_emit_op2(compiler, SLJIT_AND32, SLJIT_MEM1(state), offsetof(NativeBlockRunState, registerTop),
		SLJIT_MEM1(SLJIT_R0), static_cast<u32>(FrameField::Top), SLJIT_IMM, FRAME_WINDOW_MASK);
	sljit_emit_ijump(compiler, SLJIT_JUMP, target, 0);
}

} // namespace bmsx
