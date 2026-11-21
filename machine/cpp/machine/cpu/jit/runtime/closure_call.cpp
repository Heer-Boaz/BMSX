#include "machine/cpu/cpu.h"

#include <algorithm>

#include "machine/cpu/frame_placement.h"
#include "machine/cpu/jit/runtime/execution.h"
#include "spec/blua32/instruction_format.h"

namespace bmsx {
namespace {

// Both admission paths have committed to a live body. The fixed layout
// cannot relocate its arguments, so this instance only writes nil padding.
template<bool MayRelocate>
void commitNativeCall(NativeCpuRunState& run, const NativeBlockExitSite& exit, CallFrame& callee,
	u32 depth, const FrameEntryControl& entry, ValuePlacement formals, int cycles,
	int argumentBase = 0, bool relocatesFormals = false) {
	auto& state = run.state;
	auto& caller = *state.frame;
	auto& thread = *caller.thread;
	caller.setAdmittedTop(state.registerTop);
	caller.writeAdmittedControl(FrameField::Pc, exit.nextPc);
	caller.compilationEntry = true;
	caller.nativeContinuationCells = exit.continuationCells;
	caller.nativeContinuationPc = exit.nextPc;

	callee.executionImage = caller.executionImage;
	callee.initializeAdmittedControl(entry, thread.stack);
	if constexpr (MayRelocate) {
		if (relocatesFormals) {
			thread.stack.placeAdmitted(entry.stackBase, thread.stack, argumentBase, formals.copied, formals.padded);
			thread.stack.clearAdmitted(argumentBase, formals.copied);
		}
	}
	if (!MayRelocate || !relocatesFormals)
		thread.stack.clearAdmitted(entry.stackBase + formals.copied, formals.padded);
	thread.publishAdmittedFrame(callee, depth, entry.stackBase + entry.capacity);
	state.frame = &callee;
	state.registerTop = entry.top;
	state.remainingCycles -= cycles;
}

} // namespace

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

std::optional<NativeFixedCallPlan> CPU::captureNativeFixedCall(Blua32ExecutionImage& image, u32 prototype, int supplied) const {
	const auto version = image.romFunctions.find(prototype);
	if (!version) return std::nullopt;
	const auto* binding = bindNativeRomFunction(image, prototype);
	if (!binding) return std::nullopt;
	const auto& function = binding->entry;
	if (function.codeAddress != version->firstPc || (function.flags & BLUA32_FUNCTION_VARARG) != 0) return std::nullopt;
	const auto layout = ArgumentPlacement::forEntry(0, supplied, function);
	if (!layout) return std::nullopt;
	return NativeFixedCallPlan{prototype, version->firstPc, static_cast<u32>(layout->capacity),
		layout->formals.copied, layout->formals.padded};
}

void CPU::observeNativeCallTarget(CallFrame& frame, DecodedInstructionPage& page, u32 pc) {
	const u32 word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	auto& decoded = page.words[word];
	if (decoded.nativeCallTarget() != DecodedInstruction::CALL_TARGET_UNSEEN) return;
	u32 candidate = DecodedInstruction::CALL_TARGET_DISABLED;
	if (decoded.a < frame.registers.size()) {
		const auto value = frame.registers.get(decoded.a);
		if (valueIsClosure(value)) {
			const u32 closure = asClosure(value, m_heap);
			if (closure != 0u) {
				const ClosureRecord::BindingFlags binding{m_memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS)};
				auto& image = *frame.executionImage;
				if (!binding.latched() && binding.domain() == image.executionDomainId) {
					const u32 prototype = m_memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS);
					if (captureNativeFixedCall(image, prototype, decodeValueCount(decoded.b, -1))) candidate = prototype;
				}
			}
		}
	}
	decoded.setNativeCallTarget(candidate);
	retireNativeInstructionUsers(page, word);
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
	commitNativeCall<true>(*run, *exit, *callee, depth, {
		functionAddress, function->codeAddress, exit->lastPc, run->frameBank,
		placement.varargBase, placement.varargCount, CallResultPlacement::call(base, call.requested), placement.top(),
		closure, placement.stackBase, static_cast<i32>(placement.capacity)
	}, placement.formals, cycles, placement.argumentBase, placement.relocatesFormals);
	return target;
}

void* CPU::tryCallNativeFixedFrame(NativeCpuRunState* run, const NativeBlockExitSite* exit) noexcept {
	auto& cpu = *run->cpu;
	auto& caller = *run->state.frame;
	const auto& call = exit->operands.call;
	const auto& binding = exit->fixedCall;
	const auto& plan = binding.plan;
	const int base = call.callee;
	// A prototype version identifies code and frame layout, never captures.
	// The actual heap closure remains the owner of every capture slot.
	const auto mismatch = [&] { run->fixedCallMismatch = true; return nullptr; };
	if (static_cast<ValueTag>(caller.registers.tags()[base]) != ValueTag::Closure) return mismatch();
	const u32 closure = cpu.m_heap.closureRecordAddress(caller.registers.admittedPayload(base));
	if (!closure) return mismatch();
	const ClosureRecord::BindingFlags flags{cpu.m_memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS)};
	if (flags.latched() || flags.domain() != caller.executionImage->executionDomainId
		|| cpu.m_memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS) != plan.prototype)
		return mismatch();

	if (run->state.remainingCycles <= plan.padded) return nullptr;
	void* const target = *binding.entryCells[run->cartridgeSlot];
	if (!target) return nullptr;
	auto& thread = *caller.thread;
	const u32 depth = thread.admittedFrameDepth() + 1u;
	auto* callee = thread.retainedFrameForEntry(depth);
	if (!callee || cpu.retargetsHaltedFrame(thread, depth)) return nullptr;
	const i32 stackBase = caller.readAdmittedWindow(FrameField::StackBase) + base + 1;
	if (static_cast<size_t>(stackBase) + plan.capacity > thread.stackCapacity) return nullptr;

	const int top = plan.copied + plan.padded;
	commitNativeCall<false>(*run, *exit, *callee, depth, {
		plan.prototype, plan.entryPc, exit->lastPc, run->frameBank,
		stackBase + top, 0, CallResultPlacement::call(base, call.requested), top,
		closure, stackBase, static_cast<i32>(plan.capacity)
	}, {plan.copied, plan.padded}, plan.padded);
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
