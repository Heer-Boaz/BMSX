#include "machine/cpu/cpu.h"

#include <algorithm>

#include "machine/cpu/frame_placement.h"
#include "machine/cpu/jit/runtime/execution.h"
#include "spec/blua32/instruction_format.h"

namespace bmsx {

NativeRomCallBinding* CPU::bindNativeRomFunction(Blua32ExecutionImage& image, u32 functionAddress) const noexcept {
	auto& binding = image.nativeRomCallBindings[
		(functionAddress / BLUA32_FUNCTION_RECORD_SIZE) % NativeRomCallBinding::slotCount];
	if (binding.functionAddress != functionAddress) {
		Span<const u8> view;
		if (!m_memory.bindRomByteView(functionAddress, BLUA32_FUNCTION_RECORD_SIZE, image.executionDomainId == 1, view))
			return nullptr;
		// Cells belong to this immutable prototype and die with the image.
		// Replacing the prototype drops both of the old bindings.
		binding = {functionAddress, FunctionEntry::fromRom(view.data()), {}};
	}
	return &binding;
}

void* CPU::tryCallNativeFrame(NativeCpuRunState* run, const NativeBlockExitSite* exit) noexcept {
	auto& cpu = *run->cpu;
	auto& state = run->state;
	auto& caller = *state.frame;
	const auto& call = exit->operands.call;
	const int base = call.callee;
	// Run-state frames are bound to the linear value planes of the grant.
	switch (static_cast<ValueTag>(caller.registers.tags()[base])) {
		case ValueTag::BuiltinFunction: {
			const u32 builtin = caller.registers.admittedPayload(base);
			return nativeBuiltinLeafId(builtin) ? tryRunNativeBuiltinLeaf(run, exit, builtin) : nullptr;
		}
		case ValueTag::Closure: break;
		default: return nullptr;
	}

	// The caller's native grant has already admitted the contiguous thread
	// backing and paid the instruction prefix. This path cannot grow it.
	auto& thread = *caller.thread;
	const u32 depth = thread.admittedFrameDepth() + 1u;
	auto* callee = thread.retainedFrameForEntry(depth);
	if (!callee || cpu.retargetsHaltedFrame(thread, depth)) return nullptr;
	const u32 closure = cpu.m_heap.closureRecordAddress(caller.registers.admittedPayload(base));
	if (!closure) return nullptr;
	const ClosureRecord::BindingFlags binding{cpu.m_memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS)};
	auto& image = *caller.executionImage;
	if (binding.domain() != image.executionDomainId) return nullptr;
	const u32 functionAddress = cpu.m_memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS);

	NativeRomCallBinding* romBinding = nullptr;
	FunctionEntry latched;
	const FunctionEntry* function;
	if (binding.latched()) {
		latched = ClosureRecord::readLatchedEntry(cpu.m_memory, closure);
		function = &latched;
	} else {
		romBinding = cpu.bindNativeRomFunction(image, functionAddress);
		if (!romBinding) return nullptr;
		function = &romBinding->entry;
	}

	const int supplied = call.supplied < 0 ? std::max(state.registerTop - base - 1, 0) : call.supplied;
	const auto callerBase = caller.readAdmittedWindow(FrameField::StackBase);
	const auto admitted = ArgumentPlacement::forEntry(callerBase + base + 1, supplied, *function);
	if (!admitted) return nullptr;
	const auto& placement = *admitted;
	const size_t stackBase = placement.stackBase;
	if (stackBase > thread.stackCapacity || placement.capacity > thread.stackCapacity - stackBase) return nullptr;
	const int cycles = placement.cycles(true);
	if (state.remainingCycles <= cycles) return nullptr;

	void* const* entry = romBinding ? romBinding->entryCells[run->cartridgeSlot] : nullptr;
	const bool bindEntry = romBinding && !entry;
	if (!entry)
		entry = NativeCodeLookup::findEntryCellInRoot(run->codeRoot, function->codeAddress);
	void* const target = entry ? *entry : nullptr;
	if (!target) return nullptr;
	if (bindEntry) romBinding->entryCells[run->cartridgeSlot] = entry;

	// All declines precede the frame writes. An ordinary semantic CALL can
	// still allocate or finish an exhausted grant; this transition only
	// commits an admitted frame with a live receiving body.
	const u32 nextPc = exit->nextPc;
	caller.setAdmittedTop(state.registerTop);
	caller.writeAdmittedControl(FrameField::Pc, nextPc);
	caller.compilationEntry = true;
	caller.nativeContinuationCells = exit->continuationCells;
	caller.nativeContinuationPc = nextPc;

	callee->executionImage = &image;
	callee->initializeAdmittedControl({
		functionAddress, function->codeAddress, exit->lastPc, run->frameBank,
		placement.varargBase, placement.varargCount, CallResultPlacement::call(base, call.requested), placement.top(),
		closure, placement.stackBase, static_cast<i32>(placement.capacity)
	}, thread.stack);
	if (placement.relocatesFormals) {
		thread.stack.placeAdmitted(stackBase, thread.stack, placement.argumentBase,
			placement.formals.copied, placement.formals.padded);
		thread.stack.clearAdmitted(placement.argumentBase, placement.formals.copied);
	} else {
		thread.stack.clearAdmitted(stackBase + placement.formals.copied, placement.formals.padded);
	}
	thread.publishAdmittedFrame(*callee, depth, static_cast<i32>(placement.stackEnd()));
	state.bindFrame(*callee);
	state.registerTop = placement.top();
	state.remainingCycles -= cycles;
	return target;
}

int CPU::placeNativeVarargs(NativeBlockRunState* state, int first, int requested) noexcept {
	auto& frame = *state->frame;
	const int available = frame.readAdmittedWindow(FrameField::VarargCount);
	const bool open = requested < 0;
	const auto placement = ValuePlacement::fit(available, open ? available : requested);
	const int count = placement.count();
	const int top = first + count;
	if (count != 0 && top > frame.readAdmittedWindow(FrameField::StackCapacity)) return -1;

	const int source = frame.readAdmittedWindow(FrameField::VarargBase);
	// The caller has not published cached registers below the destination.
	// Only a source wholly below this frame is safe to read in place.
	if (placement.copied != 0 && source + placement.copied > frame.readAdmittedWindow(FrameField::StackBase))
		return -1;
	frame.registers.placeAdmitted(first, frame.thread->stack, source, placement.copied, placement.padded);
	if (open) state->registerTop = top;
	return count;
}

} // namespace bmsx
