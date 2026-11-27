#include "machine/cpu/cpu.h"

#include <algorithm>

#include "machine/cpu/frame_placement.h"
#include "machine/cpu/jit/runtime/execution.h"
#include "machine/cpu/jit/sljit/gate.h"
#include "spec/blua32/instruction_format.h"

namespace bmsx {
namespace {

inline void enterNativeActivation(NativeCpuRunState& run, const NativeBlockExitSite& exit, CallFrame& callee,
	u32 closure, int stackBase, int varargBase, size_t capacity, int top, int cycles) noexcept {
	auto& state = run.state;
	callee.executionImage = state.frame->executionImage;
	callee.registers = callee.thread->stack.linearSubspan(stackBase, capacity);
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

void NativeCpuRunState::writePendingFrame(CallFrame& frame, u32 pc, i32 top) const noexcept {
	const auto& site = *frame.pendingNativeCall;
	const auto& call = site.operands.call;
	const int supplied = call.supplied < 0 ? std::max(frame.pendingNativeCallerTop - call.callee - 1, 0) : call.supplied;
	const auto base = frame.pendingNativeStackBase;
	const auto varargBase = frame.pendingNativeVarargBase;
	const auto closure = frame.pendingNativeClosure;
	const auto prototype = cpu->memory().readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS);
	const FrameEntryControl entry{prototype, pc, site.lastPc, frameBank,
		varargBase, supplied, CallResultPlacement::call(call.callee, call.requested),
		top, closure, base, static_cast<i32>(frame.registers.size())};
	entry.writeWords([&frame](FrameField field, u32 word) { frame.writeAdmittedControl(field, word); });
}

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
		const bool current = callee == state.frame;
		const auto* nextCall = current ? nullptr : callee->next->pendingNativeCall;
		const auto resume = current ? pc : nextCall->nextPc;
		const auto top = current ? state.registerTop : callee->next->pendingNativeCallerTop;
		writePendingFrame(*callee, resume, top);
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

std::optional<NativeFixedCallPlan> CPU::captureNativeFixedCall(Blua32ExecutionImage& image, u32 prototype, int supplied) const {
	const auto version = image.romFunctions.find(prototype);
	if (!version) return std::nullopt;
	const FunctionEntry* function = &version->entry;
	if (image.romFunctions.mappedCode) {
		const auto* binding = image.bindRomFunction(m_memory, prototype);
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
	const u32 closure = ClosureRecord::recordAddress(m_memory, valuePayload(value));
	if (!closure) return;
	const ClosureRecord::BindingFlags binding{m_memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS)};
	auto& image = *frame.executionImage;
	if (binding.latched() || binding.domain() != image.executionDomainId) return;
	const u32 prototype = m_memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS);
	if (!captureNativeFixedCall(image, prototype, decodeValueCount(decoded.b, -1))) return;
	decoded.setNativeCallTarget(prototype);
}

void* CPU::resumeScalarAfterNativeTransfer(NativeCpuRunState& run, const NativeBlockExitSite& exit, u32 pc) noexcept {
	auto& cpu = *run.cpu;
	cpu.m_currentInstructionPc = exit.currentPc;
	cpu.lastPc = exit.lastPc;
	// Native transfers stay in the currently bound image. Attribute the
	// executed instruction before publishing the receiving activation.
	cpu.m_lastExecutionDomainId = cpu.m_activeExecutionDomainId;
	cpu.instructionBudgetRemaining = run.state.remainingCycles;
	run.publishActivation(pc);
	// The transfer is committed. Null instead declines it and runs the
	// original CALL or RET in the semantic dispatcher.
	return nativeBlockGate().exit;
}

void* CPU::tryCallNativeFrame(NativeCpuRunState* run, const NativeBlockExitSite* exit) noexcept {
	auto& cpu = *run->cpu;
	auto& state = run->state;
	auto& caller = *state.frame;
	const auto& call = exit->operands.call;
	if (exit->callStrategy == NativeCallStrategy::Fixed) return tryCallNativeFixedFrame(run, exit);
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

	const u32 closure = ClosureRecord::recordAddress(cpu.m_memory, caller.registers.admittedPayload(base));
	if (!closure) return nullptr;
	const ClosureRecord::BindingFlags binding{cpu.m_memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS)};
	auto& image = *caller.executionImage;
	if (binding.domain() != image.executionDomainId) return nullptr;
	const u32 functionAddress = cpu.m_memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS);

	RomCallBinding* romBinding = nullptr;
	FunctionEntry latched;
	const FunctionEntry* function;
	if (binding.latched()) {
		latched = ClosureRecord::readLatchedEntry(cpu.m_memory, closure);
		function = &latched;
	} else {
		romBinding = image.bindRomFunction(cpu.m_memory, functionAddress);
		if (!romBinding) return nullptr;
		function = &romBinding->entry;
	}

	// The shared CALL gate reads the site's binding on every entry. Publish
	// data on the CPU thread, never rewrite executable bytes or replace a
	// live region just to use the prototype that this call actually selected.
	if (exit->callStrategy == NativeCallStrategy::Observe && romBinding) {
		auto& decoded = *exit->observingCall;
		const u32 observed = decoded.nativeCallTarget();
		if (observed != DecodedInstruction::CALL_TARGET_UNSEEN && observed != functionAddress) {
			decoded.setNativeCallTarget(DecodedInstruction::CALL_TARGET_DISABLED);
			exit->callStrategy = NativeCallStrategy::Generic;
		} else if (const auto plan = cpu.captureNativeFixedCall(image, functionAddress, call.supplied)) {
			decoded.setNativeCallTarget(functionAddress);
			std::construct_at(&exit->fixedCall, NativeFixedCallBinding{*plan, romBinding->entryCells});
			exit->callStrategy = NativeCallStrategy::Fixed;
			return tryCallNativeFixedFrame(run, exit);
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
	if (bindEntry && entry) romBinding->entryCells[run->cartridgeSlot] = entry;

	// Admission of the activation is independent of code residency. Only
	// requests that need the semantic CALL path are still unplaced.
	const auto [copied, padded] = placement.formals;
	if (placement.relocatesFormals) {
		thread.stack.placeAdmitted(placement.stackBase, thread.stack, placement.argumentBase, copied, padded);
		thread.stack.clearAdmitted(placement.argumentBase, copied);
	} else {
		thread.stack.clearAdmitted(placement.stackBase + copied, padded);
	}
	enterNativeActivation(*run, *exit, *callee, closure, placement.stackBase, placement.varargBase,
		placement.capacity, placement.top(), cycles);
	return target ? target : resumeScalarAfterNativeTransfer(*run, *exit, function->codeAddress);
}

void* CPU::tryCallNativeFixedFrame(NativeCpuRunState* run, const NativeBlockExitSite* exit) noexcept {
	auto& cpu = *run->cpu;
	auto& state = run->state;
	auto& caller = *state.frame;
	const auto& call = exit->operands.call;
	auto& binding = exit->fixedCall;
	const auto& plan = binding.plan;
	const int base = call.callee;
	const auto miss = [&] {
		// All fixed entries guard their own plan. A mismatch patches only
		// this site's data and prevents new plans for the same source PC.
		auto* page = NativeCodeLookup::findInRoot(run->codeRoot, exit->currentPc);
		const auto word = (exit->currentPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		page->words[word].setNativeCallTarget(DecodedInstruction::CALL_TARGET_DISABLED);
		exit->callStrategy = NativeCallStrategy::Generic;
		return tryCallNativeFrame(run, exit);
	};
	// A prototype version identifies code and frame layout, never captures.
	// The actual heap closure remains the owner of every capture slot.
	if (static_cast<ValueTag>(caller.registers.tags()[base]) != ValueTag::Closure) {
		return miss();
	}
	const u32 closure = ClosureRecord::recordAddress(cpu.m_memory, caller.registers.admittedPayload(base));
	if (!closure) {
		return miss();
	}
	const ClosureRecord::BindingFlags flags{cpu.m_memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS)};
	if (flags.latched() || flags.domain() != caller.executionImage->executionDomainId
		|| cpu.m_memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS) != plan.prototype) {
		return miss();
	}

	if (state.remainingCycles <= plan.padded) return nullptr;
	// An observed callee need not have a native page yet. Once found,
	// the image-owned cell stays valid across retirement and republication.
	auto& cell = binding.entryCells[run->cartridgeSlot];
	if (!cell) cell = NativeCodeLookup::findEntryCellInRoot(run->codeRoot, plan.entryPc);
	void* const target = cell ? *cell : nullptr;
	auto& thread = *caller.thread;
	const u32 depth = state.frameDepth + 1u;
	auto* callee = thread.retainedFrameForEntry(caller, depth);
	if (!callee || cpu.retargetsHaltedFrame(thread, depth)) return nullptr;
	const i32 stackBase = state.stackBase + base + 1;
	if (static_cast<size_t>(stackBase) + plan.capacity > thread.stackCapacity) return nullptr;

	const int top = plan.copied + plan.padded;
	thread.stack.clearAdmitted(stackBase + plan.copied, plan.padded);
	enterNativeActivation(*run, *exit, *callee, closure, stackBase, stackBase + top, plan.capacity, top, plan.padded);
	return target ? target : resumeScalarAfterNativeTransfer(*run, *exit, plan.entryPc);
}

int CPU::placeNativeVarargs(NativeBlockRunState* state, int first, int requested) noexcept {
	auto& frame = *state->frame;
	const bool pending = frame.pendingNativeCall != nullptr;
	const int varargBase = pending ? frame.pendingNativeVarargBase : frame.readAdmittedWindow(FrameField::VarargBase);
	const int available = std::max(state->stackBase - varargBase, 0);
	const bool open = requested < 0;
	const auto placement = ValuePlacement::fit(available, open ? available : requested);
	const int count = placement.count();
	const int top = first + count;
	const int capacity = pending ? static_cast<int>(frame.registers.size())
		: frame.readAdmittedWindow(FrameField::StackCapacity);
	if (count != 0 && top > capacity) return -1;

	const int source = placement.copied == 0 ? 0 : varargBase;
	// The caller has not published cached registers below the destination.
	// Only a source wholly below this frame is safe to read in place.
	if (placement.copied != 0 && source + placement.copied > state->stackBase)
		return -1;
	frame.registers.placeAdmitted(first, frame.thread->stack, source, placement.copied, placement.padded);
	if (open) state->registerTop = top;
	return count;
}

} // namespace bmsx
