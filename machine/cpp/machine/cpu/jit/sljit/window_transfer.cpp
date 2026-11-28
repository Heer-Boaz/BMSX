#include "machine/cpu/jit/sljit/gate.h"
#include "machine/cpu/jit/sljit/abi.h"

#include "machine/cpu/jit/runtime/execution.h"
#include "machine/cpu/thread.h"

namespace bmsx {
namespace {

constexpr auto state = NativeBlockAbi::state, budget = NativeBlockAbi::budget;
constexpr auto words = NativeBlockAbi::words, tags = NativeBlockAbi::tags;
constexpr auto receiving = NativeBlockAbi::transitionExit;
constexpr auto active = offsetof(NativeBlockRunState, frame);
constexpr auto capacity = offsetof(NativeBlockRunState, registerCapacity);
constexpr auto depth = offsetof(NativeBlockRunState, frameDepth);
constexpr auto base = offsetof(NativeBlockRunState, stackBase);
constexpr auto top = offsetof(NativeBlockRunState, registerTop);
constexpr auto closure = offsetof(NativeBlockRunState, closure);
constexpr auto window = offsetof(CallFrame, registers);
constexpr auto operands = offsetof(NativeBlockExitSite, operands);
constexpr auto inputA = operands + offsetof(NativeExitOperands::RegisterWindowTransfer, a);
constexpr auto inputB = operands + offsetof(NativeExitOperands::RegisterWindowTransfer, b);
constexpr int scratchCode = NativeBlockAbi::helperResultOffset;
constexpr int scratchPc = scratchCode + sizeof(void*);
constexpr int scratchOffset = scratchPc + sizeof(u32);
constexpr int scratchWidth = scratchOffset + sizeof(u32);
constexpr int scratchTop = scratchWidth + sizeof(u32);
constexpr int scratchDepth = scratchTop + sizeof(u32);
constexpr int scratchBase = scratchDepth + sizeof(u32);
static_assert(scratchBase + sizeof(u32) <= NativeBlockAbi::stackBytes);

// These gates only operate on published frame records. A grant that
// entered through a legacy unmaterialized CALL takes its ordinary frontier
// before the new physical transfer can use those records.
void admitPhysicalTransfer(sljit_compiler* c, sljit_label* cold) {
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), offsetof(NativeBlockRunState, remainingCycles), budget, 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_SIG_LESS_EQUAL | SLJIT_32, budget, 0, SLJIT_IMM, 0), cold);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL, SLJIT_MEM1(state),
		offsetof(NativeCpuRunState, firstPendingFrame), SLJIT_IMM, 0), cold);
}

// R1 points at the outgoing RAM record; R0 is still the issuing site.
void publishOutgoing(sljit_compiler* c) {
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R1), static_cast<int>(FrameField::Pc),
		SLJIT_MEM1(SLJIT_R0), offsetof(NativeBlockExitSite, nextPc));
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), static_cast<int>(FrameField::Top),
		SLJIT_IMM, ~FRAME_WINDOW_MASK);
	sljit_emit_op2(c, SLJIT_OR32, SLJIT_MEM1(SLJIT_R1), static_cast<int>(FrameField::Top),
		SLJIT_R2, 0, SLJIT_MEM1(state), top);
}

// Thread geometry is published only after the receiving window is complete.
// R1 = absolute bound end, R2 = receiving Thread.
void publishReceiving(sljit_compiler* c, sljit_label* bindWindow) {
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R2), SLJIT_OFFSETOF(Thread, currentFrame), receiving, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R2), SLJIT_OFFSETOF(Thread, nativeRecord));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), static_cast<int>(ThreadField::StackTop), SLJIT_R1, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R2), static_cast<int>(ThreadField::FrameDepth), SLJIT_MEM1(SLJIT_SP), scratchDepth);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(state), active, receiving, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), depth, SLJIT_MEM1(SLJIT_SP), scratchDepth);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), base, SLJIT_MEM1(SLJIT_SP), scratchBase);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), top, SLJIT_MEM1(SLJIT_SP), scratchTop);
#if defined(BMSX_NATIVE_GATE_PROFILE)
	constexpr auto direct = offsetof(NativeCpuRunState, directWindowTransferResumes);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_MEM1(state), direct, SLJIT_MEM1(state), direct, SLJIT_IMM, 1);
#endif
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R0, 0, SLJIT_MEM1(SLJIT_SP), scratchCode);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R1, 0, receiving, 0, SLJIT_IMM, window);
	sljit_set_label(sljit_emit_jump(c, SLJIT_JUMP), bindWindow);
}

} // namespace

sljit_label* emitWindowEnter(sljit_compiler* c, sljit_label* bindWindow, sljit_label* cold) {
	auto* entry = sljit_emit_label(c);
	admitPhysicalTransfer(c, cold);
	sljit_emit_op1(c, SLJIT_MOV_U16, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), inputA);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_GREATER_EQUAL | SLJIT_32,
		SLJIT_R1, 0, SLJIT_MEM1(state), capacity), cold);
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_MEM2(words, SLJIT_R1), 2);
	for (auto* miss : emitResidentCodeAtPc(c)) sljit_set_label(miss, cold);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), scratchCode, SLJIT_R3, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), scratchPc, SLJIT_R2, 0);

	sljit_emit_op1(c, SLJIT_MOV_U16, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), inputB);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R1, 0, SLJIT_IMM, 3);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_GREATER | SLJIT_32,
		SLJIT_R3, 0, SLJIT_MEM1(state), capacity), cold);
	sljit_emit_op2(c, SLJIT_SHL, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 2);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_R1, 0, words, 0, SLJIT_R1, 0);
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_GREATER | SLJIT_32, SLJIT_R2, 0, SLJIT_MEM1(state), capacity), cold);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), scratchOffset, SLJIT_R2, 0);
	// Only the initial live prefix is shared. The rest is bounded by the
	// backing of the thread. Reject an oversized raw word before the add.
	sljit_emit_op2(c, SLJIT_SUB32, receiving, 0, SLJIT_MEM1(state), capacity, SLJIT_R2, 0);
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R1), sizeof(u32));
	sljit_set_label(sljit_emit_cmp(c, SLJIT_GREATER | SLJIT_32, SLJIT_R2, 0, SLJIT_IMM, MAX_THREAD_VALUE_SLOTS), cold);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), scratchWidth, SLJIT_R2, 0);
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_R1), 2 * sizeof(u32));
	sljit_set_label(sljit_emit_cmp(c, SLJIT_GREATER | SLJIT_32, SLJIT_R3, 0, SLJIT_R2, 0), cold);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_GREATER | SLJIT_32, SLJIT_R3, 0, receiving, 0), cold);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), scratchTop, SLJIT_R3, 0);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_MEM1(state), base, SLJIT_MEM1(SLJIT_SP), scratchOffset);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), scratchBase, SLJIT_R3, 0);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_R3, 0, SLJIT_R2, 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_GREATER | SLJIT_32,
		SLJIT_R3, 0, SLJIT_MEM1(state), offsetof(NativeCpuRunState, nativeStackCapacity)), cold);

	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(state), active);
	sljit_emit_op1(c, SLJIT_MOV_P, receiving, 0, SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, next));
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, receiving, 0, SLJIT_IMM, 0), cold);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(receiving), offsetof(CallFrame, nativeControl));
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_R1, 0, SLJIT_IMM, 0), cold);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R3, 0, SLJIT_MEM1(state), depth, SLJIT_IMM, 1);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_GREATER_EQUAL | SLJIT_32,
		SLJIT_R3, 0, SLJIT_MEM1(state), offsetof(NativeCpuRunState, nativeFrameLimit)), cold);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32,
		SLJIT_R3, 0, SLJIT_MEM1(state), offsetof(NativeCpuRunState, haltedCallDepth)), cold);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), scratchDepth, SLJIT_R3, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, nativeControl));
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_R1, 0, SLJIT_IMM, 0), cold);

	publishOutgoing(c);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(state), active);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(receiving), offsetof(CallFrame, executionImage),
		SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, executionImage));
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(receiving), window + ValueSpan::ramOffset(),
		SLJIT_MEM1(SLJIT_R2), window + ValueSpan::ramOffset());
	for (size_t i = 0; i < CARTRIDGE_SLOT_COUNT; ++i)
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R2),
			offsetof(CallFrame, nativeContinuationCells) + i * sizeof(void*), SLJIT_IMM, 0);

	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), scratchOffset);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_MEM1(receiving), window + ValueSpan::tagsOffset(), tags, 0, SLJIT_R1, 0);
	sljit_emit_op2(c, SLJIT_SHL, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_IMM, 2);
	sljit_emit_op2(c, SLJIT_ADD, SLJIT_MEM1(receiving), window + ValueSpan::wordsOffset(), words, 0, SLJIT_R1, 0);
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), scratchWidth);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(receiving), window + ValueSpan::sizeOffset(), SLJIT_R3, 0);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_MEM1(receiving), window + ValueSpan::mirroredOffset(), SLJIT_IMM, 0);

	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(receiving), offsetof(CallFrame, nativeControl));
	for (const auto field : {FrameField::Function, FrameField::OpenHead, FrameField::Closure, FrameField::ArgumentCount,
		FrameField::ReturnBase, FrameField::ReturnCount})
		sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R1), static_cast<int>(field), SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R1), static_cast<int>(FrameField::CallSite),
		SLJIT_MEM1(SLJIT_R0), offsetof(NativeBlockExitSite, currentPc));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R1), static_cast<int>(FrameField::Flags),
		SLJIT_MEM1(state), offsetof(NativeCpuRunState, frameBank));
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R1), static_cast<int>(FrameField::Pc), SLJIT_MEM1(SLJIT_SP), scratchPc);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R1), static_cast<int>(FrameField::Top), SLJIT_MEM1(SLJIT_SP), scratchTop);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R1), static_cast<int>(FrameField::VarargBase), SLJIT_MEM1(SLJIT_SP), scratchBase);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R1), static_cast<int>(FrameField::StackBase), SLJIT_MEM1(SLJIT_SP), scratchBase);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_R1), static_cast<int>(FrameField::StackCapacity), SLJIT_R3, 0);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), closure, SLJIT_IMM, 0);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R3, 0, SLJIT_MEM1(SLJIT_SP), scratchBase);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(receiving), offsetof(CallFrame, thread));
	publishReceiving(c, bindWindow);
	return entry;
}

sljit_label* emitWindowLeave(sljit_compiler* c, sljit_label* bindWindow, sljit_label* cold, bool fromRegister) {
	auto* entry = sljit_emit_label(c);
	admitPhysicalTransfer(c, cold);
	sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_MEM1(state), depth, SLJIT_IMM, 1);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_SIG_LESS_EQUAL | SLJIT_32,
		SLJIT_R1, 0, SLJIT_MEM1(state), offsetof(NativeCpuRunState, targetDepth)), cold);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL | SLJIT_32,
		SLJIT_R1, 0, SLJIT_MEM1(state), offsetof(NativeCpuRunState, haltedCallDepth)), cold);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), scratchDepth, SLJIT_R1, 0);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(state), active);
	sljit_emit_op1(c, SLJIT_MOV_P, receiving, 0, SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, previous));
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, receiving, 0, SLJIT_IMM, 0), cold);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(receiving), offsetof(CallFrame, executionImage));
	sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL, SLJIT_R1, 0,
		SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, executionImage)), cold);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R2), offsetof(CallFrame, nativeControl));
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_R1, 0, SLJIT_IMM, 0), cold);
	sljit_emit_op2(c, SLJIT_AND32 | SLJIT_SET_Z, SLJIT_R2, 0,
		SLJIT_MEM1(SLJIT_R1), static_cast<int>(FrameField::Flags), SLJIT_IMM, FRAME_EXCEPTION);
	sljit_set_label(sljit_emit_jump(c, SLJIT_NOT_EQUAL), cold);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(receiving), offsetof(CallFrame, nativeControl));
	sljit_set_label(sljit_emit_cmp(c, SLJIT_EQUAL, SLJIT_R3, 0, SLJIT_IMM, 0), cold);
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R3), static_cast<int>(FrameField::Flags), SLJIT_IMM, FRAME_BANK_MASK);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_NOT_EQUAL | SLJIT_32,
		SLJIT_R1, 0, SLJIT_MEM1(state), offsetof(NativeCpuRunState, frameBank)), cold);
	sljit_emit_op1(c, SLJIT_MOV_U16, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R0), inputB);
	if (fromRegister) {
		sljit_set_label(sljit_emit_cmp(c, SLJIT_GREATER_EQUAL | SLJIT_32, SLJIT_R1, 0, SLJIT_MEM1(state), capacity), cold);
		sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R1, 0, SLJIT_MEM2(words, SLJIT_R1), 2);
	}
	sljit_set_label(sljit_emit_cmp(c, SLJIT_GREATER | SLJIT_32, SLJIT_R1, 0, SLJIT_MEM1(state), capacity), cold);
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), static_cast<int>(FrameField::StackBase), SLJIT_IMM, FRAME_WINDOW_MASK);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), scratchBase, SLJIT_R2, 0);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_MEM1(state), base);
	sljit_emit_op2(c, SLJIT_SUB32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_R2, 0);
	sljit_set_label(sljit_emit_cmp(c, SLJIT_GREATER | SLJIT_32,
		SLJIT_R1, 0, SLJIT_MEM1(receiving), window + ValueSpan::sizeOffset()), cold);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(SLJIT_SP), scratchTop, SLJIT_R1, 0);
	sljit_emit_op1(c, SLJIT_MOV_U32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), static_cast<int>(FrameField::Pc));
	for (auto* miss : emitResidentCodeAtPc(c)) sljit_set_label(miss, cold);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_SP), scratchCode, SLJIT_R3, 0);

	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(state), active);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, nativeControl));
	publishOutgoing(c);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, decodedPage), SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R3), offsetof(CallFrame, compilationEntry), SLJIT_IMM, 1);
	for (const auto field : {ValueSpan::wordsOffset(), ValueSpan::tagsOffset(), ValueSpan::sizeOffset(), ValueSpan::ramOffset()})
		sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_MEM1(SLJIT_R3), window + field, SLJIT_IMM, 0);
	sljit_emit_op1(c, SLJIT_MOV_U8, SLJIT_MEM1(SLJIT_R3), window + ValueSpan::mirroredOffset(), SLJIT_IMM, 0);

	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R3, 0, SLJIT_MEM1(receiving), offsetof(CallFrame, nativeControl));
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R2, 0, SLJIT_MEM1(SLJIT_R3), static_cast<int>(FrameField::Top), SLJIT_IMM, ~FRAME_WINDOW_MASK);
	sljit_emit_op2(c, SLJIT_OR32, SLJIT_MEM1(SLJIT_R3), static_cast<int>(FrameField::Top), SLJIT_R2, 0, SLJIT_MEM1(SLJIT_SP), scratchTop);
	sljit_emit_op1(c, SLJIT_MOV32, SLJIT_MEM1(state), closure, SLJIT_MEM1(SLJIT_R3), static_cast<int>(FrameField::Closure));
	sljit_emit_op2(c, SLJIT_AND32, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_R3), static_cast<int>(FrameField::StackCapacity), SLJIT_IMM, FRAME_WINDOW_MASK);
	sljit_emit_op2(c, SLJIT_ADD32, SLJIT_R1, 0, SLJIT_R1, 0, SLJIT_MEM1(SLJIT_SP), scratchBase);
	sljit_emit_op1(c, SLJIT_MOV_P, SLJIT_R2, 0, SLJIT_MEM1(receiving), offsetof(CallFrame, thread));
	publishReceiving(c, bindWindow);
	return entry;
}

} // namespace bmsx
