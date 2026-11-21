#include "machine/cpu/cpu.h"

#include <algorithm>

#include "machine/cpu/frame_placement.h"
#include "machine/cpu/jit/runtime/execution.h"

namespace bmsx {

void* CPU::tryReturnNativeFrame(NativeCpuRunState* run, const NativeBlockExitSite* exit) noexcept {
	auto& state = run->state;
	auto& leaving = *state.frame;
	auto* caller = leaving.previous;
	const auto* pending = leaving.pendingNativeCall;
	u32 flags = 0;
	if (pending) {
		if (!caller->pendingNativeCall && (caller->readAdmittedControl(FrameField::Flags) & FRAME_BANK_MASK) != run->frameBank)
			return nullptr;
	} else {
		flags = leaving.readAdmittedControl(FrameField::Flags);
		if (!caller || caller->executionImage != leaving.executionImage
			|| (caller->readAdmittedControl(FrameField::Flags) & FRAME_BANK_MASK) != run->frameBank
			|| static_cast<i32>(leaving.readAdmittedControl(FrameField::Protected)) >= 0
			|| (flags & FRAME_COMPLETION) != 0
			|| leaving.readAdmittedControl(FrameField::OpenHead) != 0)
			return nullptr;
	}

	auto& thread = *leaving.thread;
	const u32 receivingDepth = state.frameDepth - 1u;
	if (static_cast<int>(receivingDepth) <= run->targetDepth || run->cpu->retargetsHaltedFrame(thread, static_cast<int>(receivingDepth)))
		return nullptr;

	const auto& returned = exit->operands.returned;
	const int source = returned.first;
	const int produced = returned.produced < 0 ? std::max(state.registerTop - source, 0) : returned.produced;
	const auto result = pending
		? CallResultPlacement::call(pending->operands.call.callee, pending->operands.call.requested)
		: CallResultPlacement::frame(leaving.readAdmittedWindow(FrameField::ReturnBase),
			leaving.readAdmittedWindow(FrameField::ReturnCount), flags);
	const auto placement = ValuePlacement::fit(produced, result.selected(produced));
	const int count = placement.count();
	const int extent = result.base + count;
	if (state.remainingCycles <= count
		|| (count != 0 && static_cast<size_t>(extent) > caller->registers.size())
		|| !leaving.registers.containsRange(source, placement.copied))
		return nullptr;

	const u32 pc = pending ? pending->nextPc : caller->readAdmittedControl(FrameField::Pc);
	auto cell = pending ? pending->continuationCells[run->cartridgeSlot] : caller->nativeContinuationCells[run->cartridgeSlot];
	if (!cell || (!pending && caller->nativeContinuationPc != pc))
		cell = NativeCodeLookup::findEntryCellInRoot(run->codeRoot, pc);
	void* const target = cell ? *cell : nullptr;
	if (!target)
		return nullptr;

	// All declines leave the original RET for the CPU dispatcher. From here
	// the admitted stack needs no growth, bus access or code invalidation.
	caller->registers.placeAdmitted(result.base, leaving.registers, source, placement.copied, placement.padded);
	const int nextTop = result.extendsTop()
		? result.topAfter(caller->readAdmittedWindow(FrameField::Top), count) : extent;
	if (pending) {
		if (run->firstPendingFrame == &leaving) run->firstPendingFrame = nullptr;
		thread.discardPendingFrame(leaving);
	} else {
		leaving.writeAdmittedControl(FrameField::Pc, exit->nextPc);
		leaving.setAdmittedTop(state.registerTop);
		thread.retireAdmittedFrame(leaving, *caller, receivingDepth);
	}
	state.frame = caller;
	state.frameDepth = receivingDepth;
	state.registerTop = nextTop;
	state.closure = caller->pendingNativeCall ? caller->pendingNativeClosure : caller->readAdmittedControl(FrameField::Closure);
	state.stackBase = caller->pendingNativeCall ? caller->pendingNativeStackBase : caller->readAdmittedWindow(FrameField::StackBase);
	state.remainingCycles -= count;
	return target;
}

} // namespace bmsx
