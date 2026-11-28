#include "machine/cpu/jit/sljit/gate.h"
#include "machine/cpu/jit/sljit/abi.h"

#include "machine/cpu/closure.h"
#include "machine/cpu/thread.h"
#include "machine/cpu/jit/runtime/execution.h"

namespace bmsx {

namespace {
constexpr auto returnContinuation = NativeBlockAbi::helperResultOffset;

// R0: RET, R3: pending CALL or physical frame controls, transitionExit: receiving frame. Decline
// before the first architectural write, with R0 intact. On success the
// charged budget and R3 (the caller's new top) are ready for retirement.
template<bool physical>
void emitReturnResults(sljit_compiler* c, sljit_label* semanticReturn) {
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
	constexpr auto copyBase = selectedCount + sizeof(u32);
	static_assert(copyBase + sizeof(u32) <= NativeBlockAbi::stackBytes - sizeof(u32));

	// Resolve RET and CALL independently: an open RET supplies top-first,
	// an open CALL selects all produced values. Charge the selected width.
	sljit_emit_op1(c, SLJIT_MOV32_S16, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), produced);
	auto* fixed = sljit_emit_cmp(c, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_U16, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), first);
	sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_MEM1(state), offsetof(NativeBlockRunState, physicalTop), SLJIT_R1, 0);
	auto* nonnegative = sljit_emit_cmp(c, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_IMM, 0);
	auto* supplied = sljit_emit_label(c);
	sljit_set_label(fixed, supplied);
	sljit_set_label(nonnegative, supplied);
	if constexpr (physical) {
		sljit_emit_op2(c, SLJIT_AND32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), static_cast<int>(FrameField::ReturnCount), SLJIT_IMM, FRAME_WINDOW_MASK);
		sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 1);
	} else
		sljit_emit_op1(c, SLJIT_MOV32_S16, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), requested);
	auto* selected = sljit_emit_cmp(c, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_R1, 0);
	sljit_set_label(selected, sljit_emit_label(c));
	sljit_set_label(sljit_emit_cmp(c, SLJIT_SIG_LESS_EQUAL | SLJIT_32, budget, 0, SLJIT_R2, 0), semanticReturn);
	if constexpr (physical)
		sljit_emit_op2(c, SLJIT_AND32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R3), static_cast<int>(FrameField::ReturnBase), SLJIT_IMM, FRAME_WINDOW_MASK);
	else
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
	sljit_set_label(sljit_emit_cmp(c, SLJIT_GREATER | SLJIT_32, SLJIT_R1, 0, SLJIT_MEM1(state),
		offsetof(NativeBlockRunState, windowWidth)), semanticReturn);

	// The pending callee's shared argument window starts above the caller's
	// result base (also for varargs). Forward movement preserves overlap.
	auto copyValue = [&] {
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM2(words, SLJIT_R2), 2);
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(target), window + ValueSpan::wordsOffset());
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM2(SLJIT_R1, SLJIT_R3), 2, SLJIT_R0, 0);
		sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R0, 0, SLJIT_MEM2(tags, SLJIT_R2), 0);
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(target), window + ValueSpan::tagsOffset());
		sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_MEM2(SLJIT_R1, SLJIT_R3), 0, SLJIT_R0, 0);
	};
	sljit_jump* backwardDone = nullptr;
	if constexpr (physical) {
		// Physical ReturnBase is writable; compare the actual stack addresses.
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(target), window + ValueSpan::tagsOffset());
		sljit_emit_op2(c, SLJIT_ADD, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_R3, 0);
		sljit_emit_op2(c, SLJIT_ADD, SLJIT_R0, 0, tags, 0, SLJIT_R2, 0);
		auto* forward = sljit_emit_cmp(c, SLJIT_LESS_EQUAL, SLJIT_R1, 0, SLJIT_R0, 0);
		sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), copyEnd, SLJIT_R3, 0);
		sljit_emit_op2(c, SLJIT_ADD, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_R1, 0);
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), copyBase, SLJIT_R3, 0);
		sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), copyEnd);
		auto* reverse = sljit_emit_label(c);
		sljit_emit_op2(c, SLJIT_SUB, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 1);
		sljit_emit_op2(c, SLJIT_SUB, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
		copyValue();
		sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), copyBase), reverse);
		sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), copyEnd);
		backwardDone = sljit_emit_jump(c, SLJIT_JUMP);
		sljit_set_label(forward, sljit_emit_label(c));
	}
	auto* copy = sljit_emit_label(c);
	copyValue();
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, 1);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_LESS | SLJIT_32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), copyEnd), copy);
	if constexpr (physical) sljit_set_label(backwardDone, sljit_emit_label(c));
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

sljit_label* emitNativeReturn(sljit_compiler* c, sljit_label* bindWindow, sljit_label* semanticReturn) {
	constexpr auto state = NativeBlockAbi::state;
	constexpr auto budget = NativeBlockAbi::budget;
	constexpr auto target = NativeBlockAbi::transitionExit;
	constexpr auto frame = offsetof(NativeBlockRunState, frame);
	constexpr auto pending = offsetof(CallFrame, pendingNativeCall);
	constexpr auto window = offsetof(CallFrame, registers);
	constexpr auto cells = offsetof(NativeBlockExitSite, continuationCells);
	constexpr auto slot = offsetof(NativeCpuRunState, cartridgeSlot);
	constexpr auto ptrShift = std::countr_zero(sizeof(void*));
	constexpr auto nextPc = NativeBlockAbi::stackBytes - sizeof(u32);

	// The existing gate owns an already published register cache. Until
	// every guard succeeds R0 is the original RET and the grant is unchanged.
	auto* label = sljit_emit_label(c);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_MEM1(state),
		offsetof(NativeBlockRunState, registerBase), SLJIT_IMM, 0), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(state), frame);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_MEM1(SLJIT_R1),
		offsetof(CallFrame, m_registerBase), SLJIT_IMM, 0), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, executionImage));
	sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL, SLJIT_R2, 0, SLJIT_MEM1(state),
		offsetof(NativeCpuRunState, codeImage)), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R1), pending);
	auto* physical = sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_R3, 0, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, target, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, previous));
	sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_MEM1(target),
		offsetof(CallFrame, m_registerBase), SLJIT_IMM, 0), semanticReturn);
	// A transient caller already passed admission in this grant. Crossing
	// its materialized frontier also admits the physical bank and stop depth.
	auto* nested = sljit_emit_cmp(c, SLJIT_NOT_EQUAL, SLJIT_MEM1(target), pending, SLJIT_IMM, 0);
	auto admitCaller = [&] {
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
	};
	admitCaller();
	sljit_set_label(nested, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_MEM1(state), slot);
	sljit_emit_op2(c, SLJIT_SHL, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, ptrShift);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, cells);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM2(SLJIT_R3, SLJIT_R2), 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), returnContinuation, SLJIT_R2, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), nextPc, SLJIT_MEM1(SLJIT_R0), offsetof(NativeBlockExitSite, nextPc));
	emitReturnResults<false>(c, semanticReturn);
	// Top for the receiving frame is in R3. Write the retired words from
	// the admitted CALL and RET sources even if no scalar boundary was hit.
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(state), frame);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, nativeControl));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::VarargBase),
		SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, pendingNativeVarargBase));
	constexpr auto callOperands = offsetof(NativeBlockExitSite, operands);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R1), pending);
	sljit_emit_op1(c, SLJIT_MOV32_S16, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), callOperands + offsetof(NativeExitOperands::Call, supplied));
	auto* fixed = sljit_emit_cmp(c, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R1), pending);
	sljit_emit_op1(c, SLJIT_MOV_U16, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R0), callOperands + offsetof(NativeExitOperands::Call, callee));
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R0, 0, SLJIT_R0, 0, SLJIT_IMM, 1);
	sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, pendingNativeCallerPhysicalTop), SLJIT_R0, 0);
	auto* nonnegative = sljit_emit_cmp(c, SLJIT_SIG_GREATER_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_IMM, 0);
	auto* writeCount = sljit_emit_label(c);
	sljit_set_label(fixed, writeCount);
	sljit_set_label(nonnegative, writeCount);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::ArgumentCount), SLJIT_R0, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1), pending);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::CallSite),
		SLJIT_MEM1(SLJIT_R1), offsetof(NativeBlockExitSite, lastPc));
	sljit_emit_op1(c, SLJIT_MOV_U16, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R1), callOperands + offsetof(NativeExitOperands::Call, callee));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::ReturnBase), SLJIT_R0, 0);
	sljit_emit_op1(c, SLJIT_MOV32_S16, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R1), callOperands + offsetof(NativeExitOperands::Call, requested));
	// The native CALL site encodes open as -1; the physical count is biased by one.
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::ReturnCount), SLJIT_R0, 0, SLJIT_IMM, 1);
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R0, 0, SLJIT_MEM1(state), offsetof(NativeBlockRunState, closure));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::Closure), SLJIT_R0, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(state), frame);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::Function),
		SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, pendingNativeFunction));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::OpenHead), SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::RegisterBase), SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::Flags),
		SLJIT_MEM1(state), offsetof(NativeCpuRunState, frameBank));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::Pc), SLJIT_MEM1(SLJIT_SP), nextPc);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::Top),
		SLJIT_MEM1(state), offsetof(NativeBlockRunState, physicalTop));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::StackBase),
		SLJIT_MEM1(state), offsetof(NativeBlockRunState, stackOrigin));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::StackCapacity),
		SLJIT_MEM1(state), offsetof(NativeBlockRunState, windowWidth));
	auto* retire = sljit_emit_jump(c, SLJIT_JUMP);

	sljit_set_label(physical, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV_P, target, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, previous));
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, target, 0, SLJIT_IMM, 0), semanticReturn);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_MEM1(target),
		offsetof(CallFrame, m_registerBase), SLJIT_IMM, 0), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(target), offsetof(CallFrame, executionImage));
	sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, executionImage)), semanticReturn);
	admitCaller();
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, nativeControl));
	sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_MEM1(SLJIT_R3), static_cast<int>(FrameField::OpenHead), SLJIT_IMM, 0), semanticReturn);
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), static_cast<int>(FrameField::Flags), SLJIT_IMM, FRAME_COMPLETION);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, 0), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(target), offsetof(CallFrame, nativeControl));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::Pc));
	sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_MEM1(target), offsetof(CallFrame, nativeContinuationPc)), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_MEM1(state), slot);
	sljit_emit_op2(c, SLJIT_SHL, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, ptrShift);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, offsetof(CallFrame, nativeContinuationCells));
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM2(target, SLJIT_R2), 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), returnContinuation, SLJIT_R2, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), nextPc, SLJIT_MEM1(SLJIT_R0), offsetof(NativeBlockExitSite, nextPc));
	emitReturnResults<true>(c, semanticReturn);

	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(state), frame);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, nativeControl));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::Pc), SLJIT_MEM1(SLJIT_SP), nextPc);
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::Top), SLJIT_IMM, ~FRAME_WINDOW_MASK);
	sljit_emit_op2(c, SLJIT_OR32, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::Top), SLJIT_R0, 0, SLJIT_MEM1(state), offsetof(NativeBlockRunState, physicalTop));
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::Flags), SLJIT_IMM, FRAME_EXTEND_RESULT_TOP);
	auto* exactTop = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R0, 0, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(target), offsetof(CallFrame, nativeControl));
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::Top), SLJIT_IMM, FRAME_WINDOW_MASK);
	auto* grows = sljit_emit_cmp(c, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R3, 0, SLJIT_R0, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R3, 0, SLJIT_R0, 0);
	auto* publish = sljit_emit_label(c);
	sljit_set_label(exactTop, publish);
	sljit_set_label(grows, publish);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, thread));
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R1), SLJIT_OFFSETOF(Thread, currentFrame), target, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R1), SLJIT_OFFSETOF(Thread, nativeRecord));
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(target), offsetof(CallFrame, nativeControl));
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::StackBase), SLJIT_IMM, FRAME_WINDOW_MASK);
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), static_cast<int>(FrameField::StackCapacity), SLJIT_IMM, FRAME_WINDOW_MASK);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_MEM1(SLJIT_R1), static_cast<int>(ThreadField::StackTop), SLJIT_R0, 0, SLJIT_R2, 0);
	sljit_emit_op2(c, SLJIT_SUB32, SLJIT_MEM1(SLJIT_R1), static_cast<int>(ThreadField::FrameDepth), SLJIT_MEM1(state), offsetof(NativeBlockRunState, frameDepth), SLJIT_IMM, 1);
	sljit_set_label(retire, sljit_emit_label(c));

	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(state), frame);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R1), pending, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, decodedPage), SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R1), offsetof(CallFrame, compilationEntry), SLJIT_IMM, 1);
	for (auto field : {ValueSpan::wordsOffset(), ValueSpan::tagsOffset(), ValueSpan::sizeOffset(), ValueSpan::ramOffset()})
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R1), window + field, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R1), window + ValueSpan::mirroredOffset(), SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), offsetof(NativeBlockRunState, remainingCycles), budget, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(state), frame, target, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), offsetof(NativeBlockRunState, physicalTop), SLJIT_R3, 0);
	sljit_emit_op2(c, SLJIT_SUB32, SLJIT_MEM1(state), offsetof(NativeBlockRunState, frameDepth),
		SLJIT_MEM1(state), offsetof(NativeBlockRunState, frameDepth), SLJIT_IMM, 1);
	auto* materialized = sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_MEM1(target), pending, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), offsetof(NativeBlockRunState, closure),
		SLJIT_MEM1(target), offsetof(CallFrame, pendingNativeClosure));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), offsetof(NativeBlockRunState, stackOrigin),
		SLJIT_MEM1(target), offsetof(CallFrame, pendingNativeStackBase));
	auto* rebind = sljit_emit_jump(c, SLJIT_JUMP);
	sljit_set_label(materialized, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(state), offsetof(NativeCpuRunState, firstPendingFrame), SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(target), offsetof(CallFrame, nativeControl));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), offsetof(NativeBlockRunState, closure),
		SLJIT_MEM1(SLJIT_R1), static_cast<int>(FrameField::Closure));
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_MEM1(state), offsetof(NativeBlockRunState, stackOrigin),
		SLJIT_MEM1(SLJIT_R1), static_cast<int>(FrameField::StackBase), SLJIT_IMM, FRAME_WINDOW_MASK);
	sljit_set_label(rebind, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(target), window + ValueSpan::sizeOffset());
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), offsetof(NativeBlockRunState, windowWidth), SLJIT_R1, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), returnContinuation);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R1, 0, target, 0, SLJIT_IMM, window);
	sljit_set_label(sljit_emit_jump(c, SLJIT_JUMP), bindWindow);
	return label;
}

} // namespace bmsx
