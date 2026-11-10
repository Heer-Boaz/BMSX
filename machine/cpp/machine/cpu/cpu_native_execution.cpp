#include "machine/cpu/cpu.h"
#include "machine/cpu/native_execution.h"

#include <algorithm>

#include "machine/devices/irq/controller.h"
#include "spec/blua32/image_format.h"

namespace bmsx {

#include "machine/cpu/cpu_calls.inl"
#include "machine/cpu/cpu_strings.inl"

void* CPU::dispatchNativeExit(NativeCpuRunState* run, const NativeBlockExitSite* exit) noexcept {
	auto& cpu = *run->cpu;
	auto& state = run->state;
	CallFrame* frame = state.frame;
	// Publish the complete native prefix before allocating, touching a device,
	// changing frames or retiring generated code. The descriptor can die there.
	cpu.instructionBudgetRemaining = state.remainingCycles;
	frame->pc = exit->nextPc;
	frame->top = state.registerTop;
	cpu.m_currentInstructionPc = exit->currentPc;
	cpu.m_lastExecutionDomainId = frame->executionImage->executionDomainId;
	cpu.lastPc = exit->lastPc;
	try {
		const bool continuing = exit->exit == NativeBlockExit::Continue;
		auto transition = NativeBlockTransition::NextInstruction;
		switch (exit->exit) {
		case NativeBlockExit::Continue:
			transition = NativeBlockTransition::NextInstruction;
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
		case NativeBlockExit::ControlBoundary:
			transition = NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::ExecuteFunction:
			cpu.executeFunctionAddress(toU32(frame->registers[exit->exitA]));
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
			cpu.writeUpvalue(frame->closure->upvalues[exit->exitB], frame->registers[exit->exitA]);
			break;
		case NativeBlockExit::InvalidConstant:
			throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		case NativeBlockExit::InvalidLength:
			throw LuaExecutionError(LUA_FAULT_REASON_UNKNOWN);
		case NativeBlockExit::AllocateTable: {
			const int a = exit->exitA;
			frame->registers[a] = valueTable(cpu.createTable(exit->exitB, exit->exitC));
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
					&& cpu.m_irqController.hasAssertedMaskableInterruptLine()))) return nullptr;
		auto& frames = cpu.m_activeThread->frames;
		if (static_cast<int>(frames.size()) <= run->targetDepth || cpu.instructionBudgetRemaining <= 0
			|| (cpu.m_haltedUntilIrqThread == cpu.m_activeThread
				&& cpu.m_haltedUntilIrqFrameDepth == static_cast<int>(frames.size()))) return nullptr;
		frame = frames.back().get();
		const u32 pc = frame->pc;
		if ((pc & (INSTRUCTION_BYTES - 1u)) != 0u) return nullptr;
		auto& page = cpu.decodedPageForFrame(*frame, pc);
		if (!page.nativeBlocks) return nullptr;
		auto* target = page.nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES].get();
		if (!target || cpu.instructionBudgetRemaining < target->entryCycles) return nullptr;
		// Only this pure continuation still owns its source descriptor. Hardware
		// mux changes remain behind the dispatcher, not cached cross-window links.
		if (continuing && !exit->link.code
			&& (pc & ~MAPPED_PAGE_BYTE_MASK) == (exit->currentPc & ~MAPPED_PAGE_BYTE_MASK)) target->linkFrom(*exit);
		state.registers = frame->registers;
		if (transition != NativeBlockTransition::NextInstruction) {
			state.constants = frame->executionImage->constPool.data();
			state.frame = frame;
			state.globalValues = cpu.m_globalValues.data();
			state.systemGlobalValues = cpu.m_systemGlobalValues.data();
			state.cop0Words = cpu.m_cop0Words.data();
			state.constantCount = static_cast<u32>(frame->executionImage->constPool.size());
		}
		state.remainingCycles = cpu.instructionBudgetRemaining;
		state.registerTop = frame->top;
		return target->m_body;
	} catch (...) {
		// Generated frames have no C++ unwind metadata. Preserve the actual
		// exception and rethrow only after the gate restores the registered caller.
		run->error = std::current_exception();
		return nullptr;
	}
}

} // namespace bmsx
