#include "machine/cpu/jit/sljit/abi.h"
#include "machine/cpu/jit/sljit/gate.h"

#include "machine/cpu/call_state.h"
#include "machine/cpu/jit/runtime/execution.h"

namespace bmsx {

sljit_label* emitFixedResidentCall(sljit_compiler* c, sljit_label* bindWindow, sljit_label* semanticCall) {
	constexpr auto state = NativeBlockAbi::state;
	constexpr auto budget = NativeBlockAbi::budget;
	constexpr auto saved = NativeBlockAbi::transitionExit;
	constexpr auto words = NativeBlockAbi::words;
	constexpr auto tags = NativeBlockAbi::tags;
	constexpr auto frame = offsetof(NativeBlockRunState, frame);
	constexpr auto stack = offsetof(NativeBlockRunState, stackBase);
	constexpr auto depth = offsetof(NativeBlockRunState, frameDepth);
	constexpr auto top = offsetof(NativeBlockRunState, registerTop);
	constexpr auto closure = offsetof(NativeBlockRunState, closure);
	constexpr auto window = offsetof(CallFrame, registers);
	constexpr auto operands = offsetof(NativeBlockExitSite, operands);
	constexpr auto base = operands + offsetof(NativeExitOperands::Call, callee);
	constexpr auto fixed = offsetof(NativeBlockExitSite, fixedCall);
	constexpr auto plan = fixed + offsetof(NativeFixedCallBinding, plan);
	constexpr auto capacity = plan + offsetof(NativeFixedCallPlan, capacity);
	constexpr auto cells = fixed + offsetof(NativeFixedCallBinding, entryCells);
	constexpr auto ptrShift = std::countr_zero(sizeof(void*));
	// Scratch in the already shared native frame, not a host/C call frame.
	constexpr auto callTarget = NativeBlockAbi::helperResultOffset;
	constexpr auto callStack = callTarget + sizeof(void*);
	constexpr auto callClosure = callStack + sizeof(u32);
	constexpr auto callDepth = callClosure + sizeof(u32);
	static_assert(callDepth + sizeof(u32) <= NativeBlockAbi::stackBytes);

	auto* label = sljit_emit_label(c);
	sljit_emit_op1(c, SLJIT_MOV32_U8, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0),
		operands + offsetof(NativeExitOperands::Call, strategy));
	sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_IMM,
		static_cast<sljit_sw>(NativeCallStrategy::Fixed)), semanticCall);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_MEM1(SLJIT_R0),
		plan + offsetof(NativeFixedCallPlan, padded), SLJIT_IMM, 0), semanticCall);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_SIG_LESS_EQUAL | SLJIT_32, budget, 0, SLJIT_IMM, 0), semanticCall);

	sljit_emit_op1(c, SLJIT_MOV_U16, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), base);
	sljit_emit_op1(c, SLJIT_MOV32_U8, SLJIT_R2, 0, SLJIT_MEM2(tags, SLJIT_R1), 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM,
		static_cast<sljit_sw>(ValueTag::Closure)), semanticCall);
	// The live Closure supplies its own captures. The fixed plan only
	// identifies its immutable prototype and argument placement.
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_MEM2(words, SLJIT_R1), 2);
	if constexpr (std::endian::native == std::endian::big)
		sljit_emit_op1(c, SLJIT_REV_U32, SLJIT_R2, 0, SLJIT_R2, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), callClosure, SLJIT_R2, 0);
	sljit_emit_op2(c, SLJIT_AND, saved, 0, SLJIT_R2, 0, SLJIT_IMM, GC_RECORD_MASK);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R3, saved);
	sljit_emit_op1(c, SLJIT_MOV32_U8, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), CLOSURE_BINDING_FLAGS);
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM,
		CLOSURE_BINDING_DOMAIN_MASK | CLOSURE_LATCHED_PROTOTYPE);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_MEM1(state),
		offsetof(NativeCpuRunState, closureDomain)), semanticCall);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R3, 0, saved, 0, SLJIT_IMM, CLOSURE_PROTOTYPE_ADDRESS);
	sljit_emit_op2(c, SLJIT_AND, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_IMM, RAM_RECORD_WORD_MASK);
	NativeBlockAbi::emitRamAddress(c, SLJIT_R3, SLJIT_R3);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), 0);
	if constexpr (std::endian::native == std::endian::big)
		sljit_emit_op1(c, SLJIT_REV32, SLJIT_R2, 0, SLJIT_R2, 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0),
		plan + offsetof(NativeFixedCallPlan, prototype)), semanticCall);

	// Only already-resident code and already admitted frame/stack storage.
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_MEM1(state), offsetof(NativeCpuRunState, cartridgeSlot));
	sljit_emit_op2(c, SLJIT_SHL, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, ptrShift);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R2, 0, SLJIT_R2, 0, SLJIT_IMM, cells);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM2(SLJIT_R0, SLJIT_R2), 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0), semanticCall);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_R2, 0, SLJIT_IMM, 0), semanticCall);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), callTarget, SLJIT_R2, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(state), frame);
	sljit_emit_op1(c, SLJIT_MOV_P, saved, 0, SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, next));
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, saved, 0, SLJIT_IMM, 0), semanticCall);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_MEM1(saved), offsetof(CallFrame, nativeControl),
		SLJIT_IMM, 0), semanticCall);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_MEM1(state), depth, SLJIT_IMM, 1);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R3, 0,
		SLJIT_MEM1(state), offsetof(NativeCpuRunState, nativeFrameLimit)), semanticCall);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32, SLJIT_R3, 0,
		SLJIT_MEM1(state), offsetof(NativeCpuRunState, haltedCallDepth)), semanticCall);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), callDepth, SLJIT_R3, 0);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 1);
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R3, 0, SLJIT_MEM1(state), stack);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R1, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), callStack, SLJIT_R3, 0);
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), capacity);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R2, 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_GREATER, SLJIT_R3, 0, SLJIT_MEM1(state),
		offsetof(NativeCpuRunState, nativeStackCapacity)), semanticCall);

	// Commit the exact pending activation. Neither RAM frame control nor
	// the physical thread frontier is published on this continued route.
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(saved), offsetof(CallFrame, pendingNativeCall), SLJIT_R0, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(saved), window + ValueSpan::sizeOffset(), SLJIT_R2, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(state), frame);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(saved), offsetof(CallFrame, executionImage),
		SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, executionImage));
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(saved), window + ValueSpan::ramOffset(),
		SLJIT_MEM1(SLJIT_R2), window + ValueSpan::ramOffset());
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_MEM1(saved), window + ValueSpan::mirroredOffset(), SLJIT_IMM, 0);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_MEM1(saved), window + ValueSpan::tagsOffset(), tags, 0, SLJIT_R1, 0);
	sljit_emit_op2(c, SLJIT_SHL, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 2);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_MEM1(saved), window + ValueSpan::wordsOffset(), words, 0, SLJIT_R1, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(saved), offsetof(CallFrame, pendingNativeCallerTop), SLJIT_MEM1(state), top);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R0), plan + offsetof(NativeFixedCallPlan, copied));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), top, SLJIT_R2, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), callStack);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), stack, SLJIT_R1, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(saved), offsetof(CallFrame, pendingNativeStackBase), SLJIT_R1, 0);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_MEM1(saved), offsetof(CallFrame, pendingNativeVarargBase), SLJIT_R1, 0, SLJIT_R2, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), callClosure);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), closure, SLJIT_R1, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(saved), offsetof(CallFrame, pendingNativeClosure), SLJIT_R1, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), depth, SLJIT_MEM1(SLJIT_SP), callDepth);
	constexpr auto first = offsetof(NativeCpuRunState, firstPendingFrame);
	auto* keepFirst = sljit_emit_cmp(c, SLJIT_NOT_EQUAL, SLJIT_MEM1(state), first, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(state), first, saved, 0);
	sljit_set_label(keepFirst, sljit_emit_label(c));
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(state), frame, saved, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), callTarget);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R1, 0, saved, 0, SLJIT_IMM, window);
	sljit_set_label(sljit_emit_jump(c, SLJIT_JUMP), bindWindow);
	return label;
}

} // namespace bmsx
