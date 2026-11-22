#include "machine/cpu/cpu.h"

#include <algorithm>

#include "machine/cpu/frame_placement.h"
#include "machine/cpu/jit/runtime/execution.h"
#include "spec/blua32/instruction_format.h"

namespace bmsx {
namespace {

inline void enterNativeActivation(NativeCpuRunState& run, const NativeBlockExitSite& exit, CallFrame& callee,
	u32 closure, int stackBase, int varargBase, size_t capacity, int top, int cycles) noexcept {
	auto& state = run.state;
	callee.executionImage = state.frame->executionImage;
	callee.registers = callee.thread->stack.admittedSubspan(stackBase, capacity);
	callee.pendingNativeClosure = closure;
	callee.pendingNativeStackBase = stackBase;
	callee.pendingNativeVarargBase = varargBase;
	callee.pendingNativeCallerTop = state.registerTop;
	callee.pendingNativeCall = &exit;
	if (!run.firstPendingFrame) run.firstPendingFrame = &callee;
	state.frame = &callee;
	++state.frameDepth;
	state.closure = closure;
	state.stackBase = stackBase;
	state.registerTop = top;
	state.remainingCycles -= cycles;
}

} // namespace

void NativeCpuRunState::publishActivation(u32 pc) noexcept {
	if (!firstPendingFrame) {
		state.frame->writeAdmittedControl(FrameField::Pc, pc);
		state.frame->setAdmittedTop(state.registerTop);
		return;
	}

	auto* callee = firstPendingFrame;
	auto& parent = *callee->previous;
	auto& thread = *parent.thread;
	const auto& firstCall = *callee->pendingNativeCall;
	parent.writeAdmittedControl(FrameField::Pc, firstCall.nextPc);
	parent.setAdmittedTop(callee->pendingNativeCallerTop);
	parent.nativeContinuationCells = firstCall.continuationCells;
	parent.nativeContinuationPc = firstCall.nextPc;
	parent.compilationEntry = true;
	for (;;) {
		const auto& site = *callee->pendingNativeCall;
		const auto& call = site.operands.call;
		const bool current = callee == state.frame;
		const auto* nextCall = current ? nullptr : callee->next->pendingNativeCall;
		const auto resume = current ? pc : nextCall->nextPc;
		const auto top = current ? state.registerTop : callee->next->pendingNativeCallerTop;
		const auto base = callee->pendingNativeStackBase;
		const auto varargBase = callee->pendingNativeVarargBase;
		const auto closure = callee->pendingNativeClosure;
		const auto prototype = cpu->memory().readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS);
		const FrameEntryControl entry{prototype, resume, site.lastPc, frameBank,
			varargBase, std::max(base - varargBase, 0), CallResultPlacement::call(call.callee, call.requested),
			top, closure, base, static_cast<i32>(callee->registers.size())};
		entry.writeWords([callee](FrameField field, u32 word) { callee->writeAdmittedControl(field, word); });
		callee->pendingNativeCall = nullptr;
		callee->compilationEntry = true;
		callee->nativeContinuationPc = resume;
		callee->nativeContinuationCells = current ? decltype(callee->nativeContinuationCells){} : nextCall->continuationCells;
		if (current) break;
		callee = callee->next;
	}
	thread.publishAdmittedFrame(*callee, state.frameDepth, state.stackBase + static_cast<i32>(callee->registers.size()));
	firstPendingFrame = nullptr;
}

NativeRomCallBinding* CPU::bindNativeRomFunction(Blua32ExecutionImage& image, u32 functionAddress) const noexcept {
	auto& binding = image.nativeRomCallBindings[
		(functionAddress / BLUA32_FUNCTION_RECORD_SIZE) % NativeRomCallBinding::slotCount];
	if (binding.functionAddress != functionAddress) {
		// Cells belong to this immutable prototype and die with the image.
		// Replacing the prototype drops both of the old bindings.
		if (!image.romFunctions.mappedCode) {
			binding = {functionAddress, image.romFunctions.find(functionAddress)->entry, {}};
		} else {
			Span<const u8> view;
			if (!m_memory.bindRomByteView(functionAddress, BLUA32_FUNCTION_RECORD_SIZE, image.executionDomainId == 1, view))
				return nullptr;
			binding = {functionAddress, FunctionEntry::fromRom(view.data()), {}};
		}
	}
	return &binding;
}

std::optional<NativeFixedCallPlan> CPU::captureNativeFixedCall(Blua32ExecutionImage& image, u32 prototype, int supplied) const {
	const auto version = image.romFunctions.find(prototype);
	if (!version) return std::nullopt;
	const FunctionEntry* function = &version->entry;
	if (image.romFunctions.mappedCode) {
		const auto* binding = bindNativeRomFunction(image, prototype);
		if (!binding || binding->entry.codeAddress != function->codeAddress) return std::nullopt;
		function = &binding->entry;
	}
	if ((function->flags & BLUA32_FUNCTION_VARARG) != 0) return std::nullopt;
	const auto layout = ArgumentPlacement::forEntry(0, supplied, *function);
	if (!layout) return std::nullopt;
	return NativeFixedCallPlan{prototype, function->codeAddress, static_cast<u32>(layout->capacity),
		layout->formals.copied, layout->formals.padded};
}

void CPU::observeNativeCallTarget(CallFrame& frame, DecodedInstructionPage& page, u32 pc) {
	const u32 word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
	auto& decoded = page.words[word];
	if (decoded.nativeCallTarget() != DecodedInstruction::CALL_TARGET_UNSEEN || decoded.a >= frame.registers.size()) return;
	const auto value = frame.registers.get(decoded.a);
	if (!valueIsClosure(value)) return;
	const u32 closure = asClosure(value, m_heap);
	if (!closure) return;
	const ClosureRecord::BindingFlags binding{m_memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS)};
	auto& image = *frame.executionImage;
	if (binding.latched() || binding.domain() != image.executionDomainId) return;
	const u32 prototype = m_memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS);
	if (!captureNativeFixedCall(image, prototype, decodeValueCount(decoded.b, -1))) return;
	decoded.setNativeCallTarget(prototype);
}

void* CPU::tryCallNativeFrame(NativeCpuRunState* run, const NativeBlockExitSite* exit) noexcept {
	auto& cpu = *run->cpu;
	auto& state = run->state;
	auto& caller = *state.frame;
	const auto& call = exit->operands.call;
	if (call.strategy == NativeCallStrategy::Fixed) return tryCallNativeFixedFrame(run, exit);
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

	// Learning the target doesn't invalidate the generic call. This
	// binding observes the owning decoded site until its first sample.
	if (call.strategy == NativeCallStrategy::Observe && romBinding && exit->observingCall) {
		auto& decoded = *exit->observingCall;
		if (decoded.nativeCallTarget() != DecodedInstruction::CALL_TARGET_UNSEEN) {
			exit->observingCall = nullptr;
		} else if (cpu.captureNativeFixedCall(image, functionAddress, call.supplied)) {
			decoded.setNativeCallTarget(functionAddress);
			exit->observingCall = nullptr;
		}
	}

	// The caller's native grant has already admitted the contiguous thread
	// backing and paid the instruction prefix. This path cannot grow it.
	auto& thread = *caller.thread;
	const u32 depth = state.frameDepth + 1u;
	auto* callee = thread.retainedFrameForEntry(caller, depth);
	if (!callee || cpu.retargetsHaltedFrame(thread, depth)) return nullptr;
	const int supplied = call.supplied < 0 ? std::max(state.registerTop - base - 1, 0) : call.supplied;
	const auto admitted = ArgumentPlacement::forEntry(state.stackBase + base + 1, supplied, *function);
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
	const auto [copied, padded] = placement.formals;
	if (placement.relocatesFormals) {
		thread.stack.placeAdmitted(placement.stackBase, thread.stack, placement.argumentBase, copied, padded);
		thread.stack.clearAdmitted(placement.argumentBase, copied);
	} else {
		thread.stack.clearAdmitted(placement.stackBase + copied, padded);
	}
	enterNativeActivation(*run, *exit, *callee, closure, placement.stackBase, placement.varargBase,
		placement.capacity, placement.top(), cycles);
	return target;
}

void* CPU::tryCallNativeFixedFrame(NativeCpuRunState* run, const NativeBlockExitSite* exit) noexcept {
	auto& cpu = *run->cpu;
	auto& state = run->state;
	auto& caller = *state.frame;
	const auto& call = exit->operands.call;
	const auto& binding = exit->fixedCall;
	const auto& plan = binding.plan;
	const int base = call.callee;
	// A prototype version identifies code and frame layout, never captures.
	// The actual heap closure remains the owner of every capture slot.
	if (static_cast<ValueTag>(caller.registers.tags()[base]) != ValueTag::Closure) {
		run->fixedCallMismatch = true;
		return nullptr;
	}
	const u32 closure = cpu.m_heap.closureRecordAddress(caller.registers.admittedPayload(base));
	if (!closure) {
		run->fixedCallMismatch = true;
		return nullptr;
	}
	const ClosureRecord::BindingFlags flags{cpu.m_memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS)};
	if (flags.latched() || flags.domain() != caller.executionImage->executionDomainId
		|| cpu.m_memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS) != plan.prototype) {
		run->fixedCallMismatch = true;
		return nullptr;
	}

	if (state.remainingCycles <= plan.padded) return nullptr;
	void* const target = *binding.entryCells[run->cartridgeSlot];
	if (!target) return nullptr;
	auto& thread = *caller.thread;
	const u32 depth = state.frameDepth + 1u;
	auto* callee = thread.retainedFrameForEntry(caller, depth);
	if (!callee || cpu.retargetsHaltedFrame(thread, depth)) return nullptr;
	const i32 stackBase = state.stackBase + base + 1;
	if (static_cast<size_t>(stackBase) + plan.capacity > thread.stackCapacity) return nullptr;

	const int top = plan.copied + plan.padded;
	thread.stack.clearAdmitted(stackBase + plan.copied, plan.padded);
	enterNativeActivation(*run, *exit, *callee, closure, stackBase, stackBase + top, plan.capacity, top, plan.padded);
	return target;
}

int CPU::placeNativeVarargs(NativeBlockRunState* state, int first, int requested) noexcept {
	auto& frame = *state->frame;
	const bool pending = frame.pendingNativeCall != nullptr;
	const int available = pending ? std::max(state->stackBase - frame.pendingNativeVarargBase, 0)
		: frame.readAdmittedWindow(FrameField::VarargCount);
	const bool open = requested < 0;
	const auto placement = ValuePlacement::fit(available, open ? available : requested);
	const int count = placement.count();
	const int top = first + count;
	const int capacity = pending ? static_cast<int>(frame.registers.size())
		: frame.readAdmittedWindow(FrameField::StackCapacity);
	if (count != 0 && top > capacity) return -1;

	const int source = placement.copied == 0 ? 0
		: pending ? frame.pendingNativeVarargBase : frame.readAdmittedWindow(FrameField::VarargBase);
	// The caller has not published cached registers below the destination.
	// Only a source wholly below this frame is safe to read in place.
	if (placement.copied != 0 && source + placement.copied > state->stackBase)
		return -1;
	frame.registers.placeAdmitted(first, frame.thread->stack, source, placement.copied, placement.padded);
	if (open) state->registerTop = top;
	return count;
}

} // namespace bmsx
