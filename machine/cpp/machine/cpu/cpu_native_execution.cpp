#include "machine/cpu/cpu.h"
#include "machine/cpu/native_block_abi.h"
#include "machine/cpu/native_execution.h"
#include "machine/cpu/upvalue.h"
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
	return {offsetof(CPU, m_haltedUntilIrqThreadAddress), offsetof(CPU, m_haltedUntilIrqFrameDepth)};
}
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif

#include "machine/cpu/cpu_calls.inl"
#include "machine/cpu/cpu_memory.inl"
#include "machine/cpu/cpu_control.inl"
#include "machine/cpu/cpu_strings.inl"

NativeBuiltinCallOutcome CPU::runNativeBuiltinLeaf(CPU* cpu, NativeBlockRunState* state, const NativeBlockExitSite* exit, u32 builtinWord) noexcept {
	const int base = exit->exitA;
	const int receiving = exit->exitC == 1 ? 0 : 1;
	if (static_cast<u32>(exit->exitC) > 2u || (receiving && base >= state->frame->stackCapacity()))
		return NativeBuiltinCallOutcome::Declined;
	const int count = decodeValueCount(exit->exitB, std::max(state->registerTop - base - 1, 0));
	auto& registers = state->frame->registers;
	const BuiltinArgsView args(registers.subspan(base + 1, static_cast<size_t>(count)));
	const auto& function = cpu->m_builtinFunctions[static_cast<size_t>(static_cast<BuiltinFunctionId>(builtinWord))];
	Value result;
	if (function.id == BuiltinFunctionId::SetMetatable && count != 0 && valueIsTable(args[0])) {
		const u32 word = (valuePayload(args[0]) + static_cast<u32>(TableHeader::Metatable)) & RAM_RECORD_WORD_MASK;
		if (cpu->m_memory.ramWriteWatches().anyWatched(word, 4u)) return NativeBuiltinCallOutcome::Declined;
	}
	if (!cpu->executeBuiltinLeaf(function.id, args, result)) return NativeBuiltinCallOutcome::Declined;
	if (receiving) registers.set(base, result);
	state->registerTop = base + receiving;
	state->remainingCycles -= static_cast<int>(function.cycleBase) + receiving;
	if (state->remainingCycles <= 0 || cpu->m_hardHalted || cpu->m_yieldRequested || cpu->m_threadSwitchRequested
		|| cpu->m_memoryWriteBlocked || cpu->m_nonMaskableInterruptPending
		|| ((cpu->m_cop0Words[COP0_STATUS] & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) != 0u
			&& cpu->m_irqController.hasAssertedMaskableInterruptLine()) || cpu->isHaltedUntilIrq())
		return NativeBuiltinCallOutcome::CompletedStop;
	return NativeBuiltinCallOutcome::CompletedResume;
}

void* CPU::tryRunNativeBuiltinLeaf(NativeCpuRunState* run, const NativeBlockExitSite* exit, u32 builtinWord) noexcept {
	auto& cpu = *run->cpu;
	auto& state = run->state;
#if defined(BMSX_NATIVE_GATE_PROFILE)
	++cpu.m_nativeGateProfile.builtinAttempts;
#endif
	const auto completion = runNativeBuiltinLeaf(&cpu, &state, exit, builtinWord);
	if (completion == NativeBuiltinCallOutcome::Declined) {
#if defined(BMSX_NATIVE_GATE_PROFILE)
		++cpu.m_nativeGateProfile.builtinDeclines;
#endif
		return nullptr;
	}
	CallFrame& frame = *state.frame;
	frame.compilationEntry = true;
	cpu.m_currentInstructionPc = exit->currentPc;
	cpu.m_lastExecutionDomainId = frame.executionImage->executionDomainId;
	cpu.lastPc = exit->lastPc;
	if (completion == NativeBuiltinCallOutcome::CompletedResume && static_cast<int>(cpu.m_activeThread->frameDepth()) > run->targetDepth) {
		void* const* const cell = exit->continuationCells[run->cartridgeSlot];
		if (void* target = cell ? *cell : nullptr) {
#if defined(BMSX_NATIVE_GATE_PROFILE)
			++cpu.m_nativeGateProfile.builtinResumes;
#endif
			return target;
		}
	}
	// Completion only needs a RAM frontier when it leaves the native grant.
	frame.setTop(state.registerTop);
	frame.writeControl(FrameField::Pc, exit->nextPc);
	cpu.instructionBudgetRemaining = state.remainingCycles;
#if defined(BMSX_NATIVE_GATE_PROFILE)
	++cpu.m_nativeGateProfile.builtinStops;
#endif
	return nativeBlockGate().exit;
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
		frame->writeControl(FrameField::Pc, state.scalarPc);
		frame->setTop(state.registerTop);
		run->forceScalar = true;
#if defined(BMSX_NATIVE_GATE_PROFILE)
		++gateProfile.returns;
#endif
		return nullptr;
	}
	const bool continuing = exit->exit == NativeBlockExit::Continue;
	frame->compilationEntry = true;
	cpu.m_currentInstructionPc = exit->currentPc;
	cpu.m_lastExecutionDomainId = frame->executionImage->executionDomainId;
	cpu.lastPc = exit->lastPc;
	if (continuing && state.remainingCycles > 0 && (exit->nextPc & (INSTRUCTION_BYTES - 1u)) == 0u) {
		// A pure edge cannot rebind the activation or bank. Keep the native
		// grant and top live unless we actually leave compiled execution.
		auto* page = NativeCodeLookup::findInRoot(run->codeRoot, exit->nextPc);
		if (page && page->nativeBlocks) {
			auto* target = page->nativeBlocks->entries[(exit->nextPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES].get();
			// Like the already-linked edge, this cannot change the admitted
			// frame, stack geometry, halt latch or write-watch epoch.
			if (target) {
				// Shared system code entering a selectable cartridge bank must
				// resolve that bank on each traversal instead of patching the edge.
				if (exit->link.patchAddress != 0 && !exit->link.target
					&& (frame->executionImage->executionDomainId != SYSTEM_EXECUTION_DOMAIN_ID
						|| exit->nextPc < CART_ROM_BASE || exit->currentPc >= CART_ROM_BASE)) target->linkFrom(*exit);
#if defined(BMSX_NATIVE_GATE_PROFILE)
				++gateProfile.resumes;
#endif
				return target->m_body;
			}
		}
	}
	// Publish the complete native prefix before leaving the grant, allocating,
	// touching a device or changing frames. A semantic helper can retire the descriptor.
	cpu.instructionBudgetRemaining = state.remainingCycles;
	frame->writeControl(FrameField::Pc, exit->nextPc);
	frame->setTop(state.registerTop);
	if (continuing) {
#if defined(BMSX_NATIVE_GATE_PROFILE)
		++gateProfile.returns;
#endif
		return nullptr;
	}
	// A helper may retire its source descriptor. The image owns this cell;
	// reading it after the helper observes any target withdrawal/publication.
	void* const* const continuation = exit->continuationCells[run->cartridgeSlot];
	try {
		auto transition = NativeBlockTransition::NextInstruction;
		switch (exit->exit) {
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
		case NativeBlockExit::WriteGlobal:
		case NativeBlockExit::WriteSystemGlobal: {
			auto& bank = exit->exit == NativeBlockExit::WriteGlobal ? cpu.m_globalBank : cpu.m_systemGlobalBank;
			bank.values().set(exit->exitBx, frame->registers.get(exit->exitA));
			transition = NativeBlockTransition::Redispatch;
			break;
		}
		case NativeBlockExit::WriteUpvalue:
			Upvalue::store(cpu.m_heap, frame->captureAddress(exit->exitB), frame->registers.get(exit->exitA));
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
			auto table = cpu.createTable(exit->exitB, exit->exitC);
			frame->registers.set(a, valueTable(table.address()));
			cpu.instructionBudgetRemaining -= 2 * static_cast<int>(table.storedSlotCount()) - exit->exitB;
			frame->extendTop(a + 1);
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
		if (cpu.instructionBudgetRemaining <= 0) {
#if defined(BMSX_NATIVE_GATE_PROFILE)
			++gateProfile.returns;
#endif
			return nullptr;
		}
		const bool sameWindow = transition == NativeBlockTransition::SameWindow;
		if (!sameWindow) {
			auto& thread = *cpu.m_activeThread;
			const auto depth = static_cast<int>(thread.frameDepth());
			if (depth <= run->targetDepth
				|| (cpu.m_haltedUntilIrqThreadAddress == thread.address && cpu.m_haltedUntilIrqFrameDepth == depth)
				|| thread.stackRequiresScalar()) {
#if defined(BMSX_NATIVE_GATE_PROFILE)
				++gateProfile.returns;
#endif
				return nullptr;
			}
			thread.recordNativeWrites(cpu.m_memory.ramWriteWatches());
			frame = thread.currentFrame;
		}
		// Read-only helpers preserve the admitted window. Other same-frame
		// helpers can relocate it but leave the image, bank and globals bound.
		const bool sameFrame = sameWindow || transition == NativeBlockTransition::NextInstruction;
		if (sameFrame && continuation) {
			void* target = *continuation;
			if (target) {
				state.remainingCycles = cpu.instructionBudgetRemaining;
				state.registerTop = frame->readWindow(FrameField::Top);
			}
#if defined(BMSX_NATIVE_GATE_PROFILE)
			if (target) ++gateProfile.resumes;
			else ++gateProfile.returns;
#endif
			return target;
		}
		// CALL/RET have already committed the real activation. Rebind its image
		// and instruction chip-select before looking up a warm receiving body.
		if (!frame->executionImage) {
#if defined(BMSX_NATIVE_GATE_PROFILE)
			++gateProfile.returns;
#endif
			return nullptr;
		}
		if (frame->executionImage != cpu.m_activeExecutionImage)
			cpu.latchActiveExecutionImage(frame->executionImage->executionDomainId, frame->executionImage);
		const u32 pc = frame->readControl(FrameField::Pc);
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
		run->frameBank = frameBankWord(frame->executionImage->executionDomainId);
		run->cartridgeRom = cpu.m_memory.cartridgeController().romStorage(slot);
		state.globalValues = cpu.m_globalBank.values();
		state.systemGlobalValues = cpu.m_systemGlobalBank.values();
		if (!sameFrame) {
			state.constants = frame->executionImage->constPool;
			state.frame = frame;
			state.cop0Words = cpu.m_cop0Words.data();
			state.constantCount = static_cast<u32>(frame->executionImage->constPool.size());
		}
		state.remainingCycles = cpu.instructionBudgetRemaining;
		state.registerTop = frame->readWindow(FrameField::Top);
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
