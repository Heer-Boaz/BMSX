#include "machine/cpu/jit/sljit/gate.h"
#include "machine/cpu/jit/sljit/abi.h"

#include "machine/cpu/call_state.h"
#include "machine/cpu/jit/runtime/execution.h"

namespace bmsx {

namespace {
constexpr auto returnContinuation = NativeBlockAbi::helperResultOffset;

// R0: RET, R3: pending CALL, transitionExit: receiving frame. Decline
// before the first architectural write, with R0 intact. On success the
// charged budget and R3 (the caller's new top) are ready for retirement.
void emitPendingResults(sljit_compiler* c, sljit_label* semanticReturn) {
	constexpr auto state = NativeBlockAbi::state, budget = NativeBlockAbi::budget;
	constexpr auto words = NativeBlockAbi::words, tags = NativeBlockAbi::tags;
	constexpr auto target = NativeBlockAbi::transitionExit;
	constexpr auto window = offsetof(CallFrame, registers);
	constexpr auto args = offsetof(NativeBlockExitSite, operands);
	constexpr auto callee = args + offsetof(NativeExitOperands::Call, callee);
	constexpr auto requested = args + offsetof(NativeExitOperands::Call, requested);
	constexpr auto first = args + offsetof(NativeExitOperands::Return, first);
	constexpr auto produced = args + offsetof(NativeExitOperands::Return, produced);
	constexpr auto copyEnd = returnContinuation + sizeof(void*);
	constexpr auto resultEnd = copyEnd + sizeof(u32);
	constexpr auto selectedCount = resultEnd + sizeof(u32);
	static_assert(selectedCount + sizeof(u32) <= NativeBlockAbi::stackBytes);

	// Resolve RET and CALL independently: an open RET supplies top-first,
	// an open CALL selects all produced values. Charge the selected width.
	sljit_emit_op1(c, SLJIT_MOV32_S16, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), produced);
	auto* fixed = sljit_emit_cmp(c, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_U16, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), first);
	sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_MEM1(state), offsetof(NativeBlockRunState, registerTop), SLJIT_R1, 0);
	auto* nonnegative = sljit_emit_cmp(c, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, 0);
	auto* supplied = sljit_emit_label(c);
	sljit_set_label(fixed, supplied);
	sljit_set_label(nonnegative, supplied);
	sljit_emit_op1(c, SLJIT_MOV32_S16, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), requested);
	auto* selected = sljit_emit_cmp(c, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_R1, 0);
	sljit_set_label(selected, sljit_emit_label(c));
	sljit_set_label(sljit_emit_cmp(c, SLJIT_SIG_LESS_EQUAL | SLJIT_32, budget, 0, SLJIT_R2, 0), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV_U16, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R3), callee);
	auto* discard = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), selectedCount, SLJIT_R2, 0);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R2, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), resultEnd, SLJIT_R3, 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_GREATER, SLJIT_R3, 0, SLJIT_MEM1(target), window + ValueSpan::sizeOffset()), semanticReturn);
	sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R2, 0);
	auto* fits = sljit_emit_cmp(c, SLJIT_LESS_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_R2, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_R2, 0);
	sljit_set_label(fits, sljit_emit_label(c));
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_MEM1(SLJIT_SP), copyEnd, SLJIT_R3, 0, SLJIT_R1, 0);
	auto* padOnly = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_U16, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), first);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_R2, 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_GREATER, SLJIT_R1, 0, SLJIT_MEM1(state),
		offsetof(NativeBlockRunState, registerCapacity)), semanticReturn);

	// The pending callee's shared argument window starts above the caller's
	// result base (also for varargs). Forward movement preserves overlap.
	auto* copy = sljit_emit_label(c);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM2(words, SLJIT_R2), 2);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(target), window + ValueSpan::wordsOffset());
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM2(SLJIT_R1, SLJIT_R3), 2, SLJIT_R0, 0);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R0, 0, SLJIT_MEM2(tags, SLJIT_R2), 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(target), window + ValueSpan::tagsOffset());
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_MEM2(SLJIT_R1, SLJIT_R3), 0, SLJIT_R0, 0);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 1);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_LESS | SLJIT_32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), copyEnd), copy);
	auto* placed = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), resultEnd);
	sljit_set_label(padOnly, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV_P, words, 0, SLJIT_MEM1(target), window + ValueSpan::wordsOffset());
	sljit_emit_op1(c, SLJIT_MOV_P, tags, 0, SLJIT_MEM1(target), window + ValueSpan::tagsOffset());
	auto* pad = sljit_emit_label(c);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM2(words, SLJIT_R3), 2, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_MEM2(tags, SLJIT_R3), 0, SLJIT_IMM, 0);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_LESS | SLJIT_32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), resultEnd), pad);
	sljit_set_label(placed, sljit_emit_label(c));
	sljit_emit_op2(c, SLJIT_SUB32, budget, 0, budget, 0, SLJIT_MEM1(SLJIT_SP), selectedCount);
	sljit_set_label(discard, sljit_emit_label(c));

}
} // namespace

sljit_label* emitPendingReturn(sljit_compiler* c, sljit_label* bindWindow, sljit_label* semanticReturn) {
	constexpr auto state = NativeBlockAbi::state;
	constexpr auto budget = NativeBlockAbi::budget;
	constexpr auto target = NativeBlockAbi::transitionExit;
	constexpr auto frame = offsetof(NativeBlockRunState, frame);
	constexpr auto pending = offsetof(CallFrame, pendingNativeCall);
	constexpr auto window = offsetof(CallFrame, registers);
	constexpr auto cells = offsetof(NativeBlockExitSite, continuationCells);
	constexpr auto slot = offsetof(NativeCpuRunState, cartridgeSlot);
	constexpr auto ptrShift = std::countr_zero(sizeof(void*));

	// The existing gate owns an already published register cache. Until
	// every guard succeeds R0 is the original RET and the grant is unchanged.
	auto* label = sljit_emit_label(c);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(state), frame);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R1), pending);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_R3, 0, SLJIT_IMM, 0), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV_P, target, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, previous));
	// A transient caller already passed admission in this grant. Crossing
	// its materialized frontier also admits the physical bank and stop depth.
	auto* nested = sljit_emit_cmp(c, SLJIT_NOT_EQUAL, SLJIT_MEM1(target), pending, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(target), offsetof(CallFrame, nativeControl));
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::Flags),
		SLJIT_IMM, FRAME_BANK_MASK);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0,
		SLJIT_MEM1(state), offsetof(NativeCpuRunState, frameBank)), semanticReturn);
	sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R2, 0, SLJIT_MEM1(state), offsetof(NativeBlockRunState, frameDepth), SLJIT_IMM, 1);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_SIG_LESS_EQUAL | SLJIT_32, SLJIT_R2, 0,
		SLJIT_MEM1(state), offsetof(NativeCpuRunState, targetDepth)), semanticReturn);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R2, 0,
		SLJIT_MEM1(state), offsetof(NativeCpuRunState, haltedCallDepth)), semanticReturn);
	sljit_set_label(nested, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_MEM1(state), slot);
	sljit_emit_op2(c, SLJIT_SHL, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, ptrShift);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, cells);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM2(SLJIT_R3, SLJIT_R2), 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), returnContinuation, SLJIT_R2, 0);
	emitPendingResults(c, semanticReturn);

	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(state), frame);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R1), pending, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, decodedPage), SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, compilationEntry), SLJIT_IMM, 1);
	for (auto field : {ValueSpan::wordsOffset(), ValueSpan::tagsOffset(), ValueSpan::sizeOffset(), ValueSpan::ramOffset()})
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R1), window + field, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R1), window + ValueSpan::mirroredOffset(), SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), offsetof(NativeBlockRunState, remainingCycles), budget, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(state), frame, target, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), offsetof(NativeBlockRunState, registerTop), SLJIT_R3, 0);
	sljit_emit_op2(c, SLJIT_SUB32, SLJIT_MEM1(state), offsetof(NativeBlockRunState, frameDepth),
		SLJIT_MEM1(state), offsetof(NativeBlockRunState, frameDepth), SLJIT_IMM, 1);
	auto* materialized = sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_MEM1(target), pending, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), offsetof(NativeBlockRunState, closure),
		SLJIT_MEM1(target), offsetof(CallFrame, pendingNativeClosure));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), offsetof(NativeBlockRunState, stackBase),
		SLJIT_MEM1(target), offsetof(CallFrame, pendingNativeStackBase));
	auto* rebind = sljit_emit_jump(c, SLJIT_JUMP);
	sljit_set_label(materialized, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(state), offsetof(NativeCpuRunState, firstPendingFrame), SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(target), offsetof(CallFrame, nativeControl));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), offsetof(NativeBlockRunState, closure),
		SLJIT_MEM1(SLJIT_R1), static_cast<int>(FrameField::Closure));
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_MEM1(state), offsetof(NativeBlockRunState, stackBase),
		SLJIT_MEM1(SLJIT_R1), static_cast<int>(FrameField::StackBase), SLJIT_IMM, FRAME_WINDOW_MASK);
	sljit_set_label(rebind, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), returnContinuation);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R1, 0, target, 0, SLJIT_IMM, window);
	sljit_set_label(sljit_emit_jump(c, SLJIT_JUMP), bindWindow);
	return label;
}

} // namespace bmsx
