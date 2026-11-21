#include "machine/cpu/cpu.h"

#include <algorithm>

#include "machine/cpu/frame_placement.h"
#include "machine/cpu/native_execution.h"

namespace bmsx {

void* CPU::tryReturnNativeFrame(NativeCpuRunState* run, const NativeBlockExitSite* exit) noexcept {
	auto& state = run->state;
	auto& leaving = *state.frame;
	auto* caller = leaving.previous;
	if (!caller || caller->executionImage != leaving.executionImage
		|| (caller->readAdmittedControl(FrameField::Flags) & FRAME_BANK_MASK) != run->frameBank
		|| static_cast<i32>(leaving.readAdmittedControl(FrameField::Protected)) >= 0
		|| (leaving.readAdmittedControl(FrameField::Flags) & FRAME_COMPLETION) != 0
		|| leaving.readAdmittedControl(FrameField::OpenHead) != 0)
		return nullptr;

	auto& thread = *leaving.thread;
	const u32 receivingDepth = thread.admittedFrameDepth() - 1u;
	if (static_cast<int>(receivingDepth) <= run->targetDepth || run->cpu->retargetsHaltedFrame(thread, static_cast<int>(receivingDepth)))
		return nullptr;

	const int source = exit->exitA;
	const int produced = decodeValueCount(exit->exitB, std::max(state.registerTop - source, 0));
	const int destination = leaving.readAdmittedWindow(FrameField::ReturnBase);
	const int encodedCount = leaving.readAdmittedWindow(FrameField::ReturnCount);
	const auto placement = ValuePlacement::fit(produced, decodeValueCount(encodedCount, produced));
	const int count = placement.count();
	const int nextTop = destination + count;
	if (state.remainingCycles <= count
		|| (count != 0 && static_cast<size_t>(nextTop) > caller->registers.size())
		|| (placement.copied != 0 && static_cast<size_t>(source + placement.copied) > leaving.registers.size()))
		return nullptr;

	const u32 pc = caller->readAdmittedControl(FrameField::Pc);
	auto cell = caller->nativeContinuationCells[run->cartridgeSlot];
	if (!cell || caller->nativeContinuationPc != pc)
		cell = NativeCodeLookup::findEntryCellInRoot(run->codeRoot, pc);
	void* const target = cell ? *cell : nullptr;
	if (!target)
		return nullptr;

	// All declines leave the original RET for the CPU dispatcher. From here
	// the admitted stack needs no growth, bus access or code invalidation.
	leaving.writeAdmittedControl(FrameField::Pc, exit->nextPc);
	leaving.setAdmittedTop(state.registerTop);
	caller->registers.placeAdmitted(destination, leaving.registers, source, placement.copied, placement.padded);
	caller->setAdmittedTop(nextTop);
	thread.retireAdmittedFrame(leaving, *caller, receivingDepth);
	state.frame = caller;
	state.registerTop = nextTop;
	state.remainingCycles -= count;
	return target;
}

} // namespace bmsx
