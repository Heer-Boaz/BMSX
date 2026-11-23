#include "machine/cpu/jit/sljit/gate.h"
#include "machine/cpu/jit/sljit/abi.h"

#include "machine/cpu/call_state.h"
#include "machine/cpu/jit/runtime/execution.h"

namespace bmsx {

sljit_label* emitPendingReturn(sljit_compiler* c, sljit_label* bindWindow, sljit_label* semanticReturn) {
	constexpr auto state = NativeBlockAbi::state;
	constexpr auto budget = NativeBlockAbi::budget;
	constexpr auto target = NativeBlockAbi::transitionExit;
	constexpr auto words = NativeBlockAbi::words;
	constexpr auto tags = NativeBlockAbi::tags;
	constexpr auto frame = offsetof(NativeBlockRunState, frame);
	constexpr auto pending = offsetof(CallFrame, pendingNativeCall);
	constexpr auto window = offsetof(CallFrame, registers);
	constexpr auto args = offsetof(NativeBlockExitSite, operands);
	constexpr auto callee = args + offsetof(NativeExitOperands::Call, callee);
	constexpr auto requested = args + offsetof(NativeExitOperands::Call, requested);
	constexpr auto first = args + offsetof(NativeExitOperands::Return, first);
	constexpr auto produced = args + offsetof(NativeExitOperands::Return, produced);
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
	// Both activations are owned by this still-running grant. The caller
	// already passed depth/halt/domain admission and has not been observed.
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_MEM1(target), pending, SLJIT_IMM, 0), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV32_U16, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), produced);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_GREATER | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 1), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV32_U16, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), requested);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_R1, 0), semanticReturn);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_SIG_LESS_EQUAL | SLJIT_32, budget, 0, SLJIT_R1, 0), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_MEM1(state), slot);
	sljit_emit_op2(c, SLJIT_SHL, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, ptrShift);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, cells);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM2(SLJIT_R3, SLJIT_R2), 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV_U16, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R3), callee);
	auto* discards = sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM, 0);

	// One produced and requested result. Alias is permitted by the stack
	// model: the single-value copy reads the live payload and tag.
	sljit_emit_op1(c, SLJIT_MOV_U16, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), first);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_GREATER_EQUAL, SLJIT_R1, 0,
		SLJIT_MEM1(state), offsetof(NativeBlockRunState, registerCapacity)), semanticReturn);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_GREATER_EQUAL, SLJIT_R3, 0,
		SLJIT_MEM1(target), window + ValueSpan::sizeOffset()), semanticReturn);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R0, 0, SLJIT_MEM2(words, SLJIT_R1), 2);
	sljit_emit_op1(c, SLJIT_MOV_P, words, 0, SLJIT_MEM1(target), window + ValueSpan::wordsOffset());
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM2(words, SLJIT_R3), 2, SLJIT_R0, 0);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_R0, 0, SLJIT_MEM2(tags, SLJIT_R1), 0);
	sljit_emit_op1(c, SLJIT_MOV_P, tags, 0, SLJIT_MEM1(target), window + ValueSpan::tagsOffset());
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_MEM2(tags, SLJIT_R3), 0, SLJIT_R0, 0);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, 1);
	sljit_emit_op2(c, SLJIT_SUB32, budget, 0, budget, 0, SLJIT_IMM, 1);
	sljit_set_label(discards, sljit_emit_label(c));

	// Detach only the transient child; firstPendingFrame and guest RAM
	// frame controls still name the materialized frontier.
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
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), offsetof(NativeBlockRunState, closure),
		SLJIT_MEM1(target), offsetof(CallFrame, pendingNativeClosure));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), offsetof(NativeBlockRunState, stackBase),
		SLJIT_MEM1(target), offsetof(CallFrame, pendingNativeStackBase));
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_R2, 0);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R1, 0, target, 0, SLJIT_IMM, window);
	sljit_set_label(sljit_emit_jump(c, SLJIT_JUMP), bindWindow);
	return label;
}

} // namespace bmsx
