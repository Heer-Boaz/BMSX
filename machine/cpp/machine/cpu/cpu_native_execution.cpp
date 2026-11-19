#include "machine/cpu/cpu.h"
#include "machine/cpu/native_execution.h"
#include "machine/cpu/value_arithmetic.h"

#include <algorithm>

#include "machine/common/numeric.h"
#include "machine/devices/irq/controller.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {

#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Winvalid-offsetof"
#endif
CPU::NativeFrameOffsets CPU::nativeFrameOffsets() {
	return {offsetof(CPU, m_haltedUntilIrqThread), offsetof(CPU, m_haltedUntilIrqFrameDepth)};
}
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

#include "machine/cpu/cpu_calls.inl"
#include "machine/cpu/cpu_memory.inl"
#include "machine/cpu/cpu_control.inl"
#include "machine/cpu/cpu_strings.inl"

NativeBuiltinCallOutcome CPU::runNativeBuiltinLeaf(CPU* cpu, NativeBlockRunState* state, const NativeBlockExitSite* exit) noexcept {
	const int base = exit->exitA;
	const int receiving = exit->exitC == 1 ? 0 : 1;
	if (static_cast<u32>(exit->exitC) > 2u || (receiving && base >= state->frame->stackCapacity))
		return NativeBuiltinCallOutcome::Declined;
	const int count = decodeValueCount(exit->exitB, std::max(state->registerTop - base - 1, 0));
	const BuiltinArgsView args(state->registers.subspan(base + 1, static_cast<size_t>(count)));
	const auto& function = cpu->m_builtinFunctions[static_cast<size_t>(asBuiltinFunctionId(state->registers.get(base)))];
	Value result;
	if ((function.id == BuiltinFunctionId::SetMetatable && cpu->m_memory.ramWriteWatches().anyWatched())
		|| !cpu->executeBuiltinLeaf(function.id, args, result)) return NativeBuiltinCallOutcome::Declined;
	if (receiving) state->registers.set(base, result);
	state->registerTop = base + receiving;
	state->remainingCycles -= static_cast<int>(function.cycleBase) + receiving;
	if (state->remainingCycles <= 0 || cpu->m_hardHalted || cpu->m_yieldRequested || cpu->m_threadSwitchRequested
		|| cpu->m_memoryWriteBlocked || cpu->m_nonMaskableInterruptPending
		|| ((cpu->m_cop0Words[COP0_STATUS] & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) != 0u
			&& cpu->m_irqController.hasAssertedMaskableInterruptLine()) || cpu->isHaltedUntilIrq())
		return NativeBuiltinCallOutcome::CompletedStop;
	return NativeBuiltinCallOutcome::CompletedResume;
}

NativeBuiltinCallOutcome CPU::tryRunNativeBuiltinLeaf(NativeCpuRunState* run, const NativeBlockExitSite* exit) noexcept {
	auto& cpu = *run->cpu;
	auto& state = run->state;
#if defined(BMSX_NATIVE_GATE_PROFILE)
	++cpu.m_nativeGateProfile.builtinAttempts;
#endif
	auto completion = runNativeBuiltinLeaf(&cpu, &state, exit);
	if (completion == NativeBuiltinCallOutcome::Declined) {
#if defined(BMSX_NATIVE_GATE_PROFILE)
		++cpu.m_nativeGateProfile.builtinDeclines;
#endif
		return completion;
	}
	CallFrame& frame = *state.frame;
	frame.top = state.registerTop;
	frame.pc = exit->nextPc;
	frame.compilationEntry = true;
	cpu.m_currentInstructionPc = exit->currentPc;
	cpu.m_lastExecutionDomainId = frame.executionImage->executionDomainId;
	cpu.lastPc = exit->lastPc;
	cpu.instructionBudgetRemaining = state.remainingCycles;
	if (completion == NativeBuiltinCallOutcome::CompletedResume) {
		void* const* continuation = exit->continuationCells[run->cartridgeSlot];
		if (!continuation || !*continuation || static_cast<int>(cpu.m_activeThread->frameDepth) <= run->targetDepth)
			completion = NativeBuiltinCallOutcome::CompletedStop;
	}
#if defined(BMSX_NATIVE_GATE_PROFILE)
	if (completion == NativeBuiltinCallOutcome::CompletedResume) ++cpu.m_nativeGateProfile.builtinResumes;
	else ++cpu.m_nativeGateProfile.builtinStops;
#endif
	return completion;
}

void* CPU::dispatchNativeExit(NativeCpuRunState* run, const NativeBlockExitSite* exit) noexcept {
	auto& cpu = *run->cpu;
#if defined(BMSX_NATIVE_GATE_PROFILE)
	auto& gateProfile = cpu.m_nativeGateProfile.exits[static_cast<size_t>(exit->exit)];
	++gateProfile.entries;
#endif
	auto& state = run->state;
	CallFrame* frame = state.frame;
	if (exit->exit == NativeBlockExit::ScalarBoundary) {
		cpu.instructionBudgetRemaining = state.remainingCycles;
		frame->pc = state.scalarPc;
		frame->top = state.registerTop;
		run->forceScalar = true;
#if defined(BMSX_NATIVE_GATE_PROFILE)
		++gateProfile.returns;
#endif
		return nullptr;
	}
	// Publish the complete native prefix before allocating, touching a device,
	// changing frames or retiring generated code. The descriptor can die there.
	cpu.instructionBudgetRemaining = state.remainingCycles;
	frame->pc = exit->nextPc;
	frame->compilationEntry = true;
	frame->top = state.registerTop;
	cpu.m_currentInstructionPc = exit->currentPc;
	cpu.m_lastExecutionDomainId = frame->executionImage->executionDomainId;
	cpu.lastPc = exit->lastPc;
	// A helper may retire its source descriptor. The image owns this cell;
	// reading it after the helper observes any target withdrawal/publication.
	void* const* const continuation = exit->continuationCells[run->cartridgeSlot];
	try {
		const bool continuing = exit->exit == NativeBlockExit::Continue;
		auto transition = NativeBlockTransition::NextInstruction;
		switch (exit->exit) {
		case NativeBlockExit::Continue:
			transition = NativeBlockTransition::NextInstruction;
			break;
		case NativeBlockExit::CompletedCall:
			transition = NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::Call:
			transition = cpu.executeCall(*frame, exit->exitA, exit->exitB, exit->exitC)
				? NativeBlockTransition::RebindFrame : NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::Return:
			transition = cpu.executeReturn(*frame, exit->exitA, exit->exitB)
				? NativeBlockTransition::RebindFrame : NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::Halt:
			cpu.haltUntilIrq();
			transition = NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::ControlFault:
			if (cpu.isUserMode()) cpu.enterSynchronousException(*frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
			else cpu.hardHalt();
			transition = NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::WriteControl:
			cpu.executeControlWrite(*frame, exit->exitA, exit->exitB);
			transition = NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::ControlBoundary:
			transition = NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::ExecuteFunction:
			cpu.executeFunctionAddress(wordOperand(frame->registers.get(exit->exitA)));
			transition = NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::ExceptionReturn:
			cpu.returnFromException(*frame);
			transition = NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::CreateClosure:
			cpu.executeClosure(*frame, exit->exitA, exit->exitBx, exit->exitC);
			transition = NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::Concat:
			cpu.executeConcat(*frame, exit->exitA, exit->exitB, exit->exitC);
			break;
		case NativeBlockExit::ConcatRange:
			cpu.executeConcatRange(*frame, exit->exitA, exit->exitB, exit->exitC);
			break;
		case NativeBlockExit::SkipInstruction:
			cpu.skipNextInstruction(*frame);
			transition = NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::Vararg:
			cpu.executeVararg(*frame, exit->exitA, exit->exitB);
			break;
		case NativeBlockExit::WriteUpvalue:
			cpu.writeUpvalue(static_cast<Upvalue*>(cpu.m_heap.object(frame->closure->upvalues[exit->exitB])), frame->registers.get(exit->exitA));
			break;
		case NativeBlockExit::InvalidOperand:
		case NativeBlockExit::InvalidConstant:
			throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		case NativeBlockExit::InvalidLength:
			throw LuaExecutionError(LUA_FAULT_REASON_UNKNOWN);
		case NativeBlockExit::ReadMemory:
			cpu.executeMemoryLoad(*frame, exit->exitA, static_cast<MemoryAccessKind>(exit->exitC),
				wordOperand(readRK(*frame->executionImage, frame->registers, exit->exitB)) + exit->exitBx);
			transition = NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::WriteMemory:
			cpu.executeMemoryStore(*frame, exit->exitA, static_cast<MemoryAccessKind>(exit->exitC),
				wordOperand(readRK(*frame->executionImage, frame->registers, exit->exitB)) + exit->exitBx);
			transition = NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::WriteWords:
			cpu.executeWordStores(*frame,
				wordOperand(readRK(*frame->executionImage, frame->registers, exit->exitB)) + exit->exitBx,
				exit->exitA, exit->exitC);
			transition = NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::AllocateTable: {
			const int a = exit->exitA;
			auto* table = cpu.createTable(exit->exitB, exit->exitC);
			frame->registers.set(a, valueTable(cpu.m_heap.reference(table)));
			cpu.instructionBudgetRemaining -= 2 * static_cast<int>(table->storedSlotCount()) - exit->exitB;
			frame->top = std::max(frame->top, a + 1);
			break;
		}
		default:
			transition = exit->handler(&cpu, frame, exit);
			break;
		}
		if (transition == NativeBlockTransition::Redispatch
			&& (cpu.m_hardHalted || cpu.m_yieldRequested || cpu.m_threadSwitchRequested || cpu.m_memoryWriteBlocked
				|| cpu.m_nonMaskableInterruptPending
				|| ((cpu.m_cop0Words[COP0_STATUS] & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) != 0u
					&& cpu.m_irqController.hasAssertedMaskableInterruptLine()))) {
#if defined(BMSX_NATIVE_GATE_PROFILE)
			++gateProfile.returns;
#endif
			return nullptr;
		}
		const auto& thread = *cpu.m_activeThread;
		if (static_cast<int>(thread.frameDepth) <= run->targetDepth || cpu.instructionBudgetRemaining <= 0
			|| (cpu.m_haltedUntilIrqThread == cpu.m_activeThread
				&& cpu.m_haltedUntilIrqFrameDepth == static_cast<int>(thread.frameDepth))) {
#if defined(BMSX_NATIVE_GATE_PROFILE)
			++gateProfile.returns;
#endif
			return nullptr;
		}
		frame = thread.currentFrame;
		if (transition == NativeBlockTransition::NextInstruction && continuation) {
			// These helpers neither change frames nor operate a device. Keep the
			// latched image/bank and avoid resolving their fixed successor again.
			state.registers = frame->registers;
			state.globalValues = cpu.m_globalValues.view();
			state.systemGlobalValues = cpu.m_systemGlobalValues.view();
			state.remainingCycles = cpu.instructionBudgetRemaining;
			state.registerTop = frame->top;
#if defined(BMSX_NATIVE_GATE_PROFILE)
			if (*continuation) ++gateProfile.resumes;
			else ++gateProfile.returns;
#endif
			return *continuation;
		}
		// CALL/RET have already committed the real activation. Rebind its image
		// and instruction chip-select before looking up a warm receiving body.
		if (frame->executionImage != cpu.m_activeExecutionImage) cpu.latchActiveExecutionImage(*frame->executionImage);
		const u32 pc = frame->pc;
		if ((pc & (INSTRUCTION_BYTES - 1u)) != 0u) {
#if defined(BMSX_NATIVE_GATE_PROFILE)
			++gateProfile.returns;
#endif
			return nullptr;
		}
		const auto& lookup = frame->executionImage->nativeCodeLookup;
		if (!lookup) {
#if defined(BMSX_NATIVE_GATE_PROFILE)
			++gateProfile.returns;
#endif
			return nullptr;
		}
		const u32 slot = cpu.m_memory.cartridgeController().selectedSlot(cpu.m_executionBusSignals);
		auto* page = lookup->find(pc, slot);
		if (!page || !page->nativeBlocks) {
#if defined(BMSX_NATIVE_GATE_PROFILE)
			++gateProfile.returns;
#endif
			return nullptr;
		}
		auto* target = page->nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES].get();
		if (!target) {
#if defined(BMSX_NATIVE_GATE_PROFILE)
			++gateProfile.returns;
#endif
			return nullptr;
		}
		// Every helper can change socket selection, even without changing the
		// frame/image. Bind the live physical bank again before native dispatch.
		run->codeRoot = lookup->root(slot);
		run->cartridgeSlot = slot;
		run->cartridgeRom = cpu.m_memory.cartridgeController().romStorage(slot);
		// A pure continuation still owns its descriptor. Cross-page links are
		// stable except a system-image edge from shared memory into the selectable
		// cartridge window. Cartridge source pages already have physical identity;
		// cartridge execution domains additionally pin every instruction fetch.
		// An internal typed-edge admission miss has no rewritable branch.
		// Only emitted external continuations participate in cross-region linking.
		if (continuing && exit->link.patchAddress != 0 && !exit->link.target
			&& (frame->executionImage->executionDomainId != SYSTEM_EXECUTION_DOMAIN_ID
				|| pc < CART_ROM_BASE || exit->currentPc >= CART_ROM_BASE)) target->linkFrom(*exit);
		state.registers = frame->registers;
		state.globalValues = cpu.m_globalValues.view();
		state.systemGlobalValues = cpu.m_systemGlobalValues.view();
		if (transition != NativeBlockTransition::NextInstruction) {
			state.constants = frame->executionImage->constPool.view();
			state.frame = frame;
			state.cop0Words = cpu.m_cop0Words.data();
			state.constantCount = static_cast<u32>(frame->executionImage->constPool.capacity());
		}
		state.remainingCycles = cpu.instructionBudgetRemaining;
		state.registerTop = frame->top;
#if defined(BMSX_NATIVE_GATE_PROFILE)
		++gateProfile.resumes;
#endif
		return target->m_body;
	} catch (...) {
		// Generated frames have no C++ unwind metadata. Preserve the actual
		// exception and rethrow only after the gate restores the registered caller.
		run->error = std::current_exception();
#if defined(BMSX_NATIVE_GATE_PROFILE)
		++gateProfile.exceptions;
		++gateProfile.returns;
#endif
		return nullptr;
	}
}

} // namespace bmsx
