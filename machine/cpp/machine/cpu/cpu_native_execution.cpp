#include "machine/cpu/cpu.h"
#include "machine/cpu/frame_placement.h"
#include "machine/cpu/native_block_abi.h"
#include "machine/cpu/native_execution.h"
#include "machine/cpu/native_table_constructor.h"
#include "machine/cpu/upvalue.h"
#include "machine/cpu/value_arithmetic.h"
#include "machine/cpu/value_length.h"

#include <algorithm>

#include "machine/common/numeric.h"
#include "machine/devices/irq/controller.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {

namespace {
enum class NativeBlockTransition : u8 {
	Redispatch,
	RebindFrame,
	// The same frame/image remains active; its register storage may have changed.
	NextInstruction,
	// Read-only lookup plus a result write in the already-admitted window.
	SameWindow,
};
} // namespace

#include "machine/cpu/cpu_calls.inl"
#include "machine/cpu/cpu_memory.inl"
#include "machine/cpu/cpu_control.inl"
#include "machine/cpu/cpu_strings.inl"

Value CPU::loadNativeTableField(TableStringReadCache& cache, const Value& base, StringId key) {
	TableLookupResult result;
	TableRecord(m_heap, tableIndexAddress(base)).resolveStringIndexPath(
		asStringId(m_indexKey), key, cache.receiverSlot, result, cache);
	chargeTableLookup(result);
	return result.value;
}

u32 CPU::readNativeLength(NativeBlockRunState* state, const StringPool* strings, Value* operand) noexcept {
	const auto length = measureValueLength(*operand, *strings, state->heap);
	if (!length) return 0;
	state->remainingCycles -= length->extraCycles;
	*operand = valueInteger(length->count);
	return 1;
}

NativeBuiltinCallOutcome CPU::runNativeBuiltinLeaf(CPU* cpu, NativeBlockRunState* state, const NativeBlockExitSite* exit, u32 builtinWord) noexcept {
	const auto& call = exit->operands.call;
	const int base = call.callee;
	const int receiving = call.requested == 0 ? 0 : 1;
	if (call.requested > 1 || (receiving && base >= state->frame->stackCapacity()))
		return NativeBuiltinCallOutcome::Declined;
	const int count = call.supplied < 0 ? std::max(state->registerTop - base - 1, 0) : call.supplied;
	auto& registers = state->frame->registers;
	const BuiltinArgsView args(registers.subspan(base + 1, static_cast<size_t>(count)));
	const auto& function = cpu->m_builtinFunctions[static_cast<size_t>(static_cast<BuiltinFunctionId>(builtinWord))];
	Value result;
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
		if (exit->operands.replay.hasCompletedInstruction) {
			cpu.m_currentInstructionPc = exit->currentPc;
			cpu.m_lastExecutionDomainId = frame->executionImage->executionDomainId;
			cpu.lastPc = exit->lastPc;
		}
		cpu.instructionBudgetRemaining = state.remainingCycles;
		frame->writeControl(FrameField::Pc, exit->nextPc);
		frame->setTop(state.registerTop);
		run->replayPc = exit->nextPc;
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
	void* const* continuation = exit->continuationCells[run->cartridgeSlot];
	try {
		auto transition = NativeBlockTransition::NextInstruction;
		switch (exit->exit) {
		case NativeBlockExit::CompletedCall:
			transition = NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::Call: {
			const auto& call = exit->operands.call;
			transition = cpu.executeCall(*frame, call.callee, call.supplied, call.requested)
				? NativeBlockTransition::RebindFrame : NativeBlockTransition::Redispatch;
			break;
		}
		case NativeBlockExit::Return: {
			const auto& returned = exit->operands.returned;
			transition = cpu.executeReturn(*frame, returned.first, returned.produced)
				? NativeBlockTransition::RebindFrame : NativeBlockTransition::Redispatch;
			break;
		}
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
			cpu.executeControlWrite(*frame, exit->operands.control.slot, exit->operands.control.field);
			transition = NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::ControlBoundary:
			transition = NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::ExceptionReturn:
			cpu.returnFromException(*frame);
			transition = NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::CreateClosure: {
			const auto& closure = exit->operands.closure;
			cpu.executeClosure(*frame, closure.result, closure.address, closure.flags);
			transition = NativeBlockTransition::Redispatch;
			break;
		}
		case NativeBlockExit::Concat: {
			const auto& concat = exit->operands.concat;
			cpu.executeConcat(*frame, concat.result, concat.left, concat.right);
			break;
		}
		case NativeBlockExit::ConcatRange: {
			const auto& concat = exit->operands.concatRange;
			cpu.executeConcatRange(*frame, concat.result, concat.first, concat.count);
			break;
		}
		case NativeBlockExit::SkipInstruction:
			cpu.skipNextInstruction(*frame);
			transition = NativeBlockTransition::Redispatch;
			break;
		case NativeBlockExit::Vararg:
			cpu.executeVararg(*frame, exit->operands.vararg.first, exit->operands.vararg.requested);
			break;
		case NativeBlockExit::WriteGlobal:
		case NativeBlockExit::WriteSystemGlobal: {
			auto& bank = exit->exit == NativeBlockExit::WriteGlobal ? cpu.m_globalBank : cpu.m_systemGlobalBank;
			bank.values().set(exit->operands.global.index, frame->registers.get(exit->operands.global.slot));
			transition = NativeBlockTransition::Redispatch;
			break;
		}
		case NativeBlockExit::WriteUpvalue:
			Upvalue::store(cpu.m_heap, frame->captureAddress(exit->operands.upvalue.capture), frame->registers.get(exit->operands.upvalue.slot));
			break;
		case NativeBlockExit::InvalidOperand:
		case NativeBlockExit::InvalidConstant:
			throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		case NativeBlockExit::InvalidLength:
			throw LuaExecutionError(LUA_FAULT_REASON_UNKNOWN);
		case NativeBlockExit::ReadField: {
			const auto access = exit->operands.table;
			frame->registers.set(access.value, cpu.loadNativeTableField(exit->tableReadCache,
				frame->registers.get(access.receiver), asStringId(frame->executionImage->constPool.get(access.key))));
			frame->extendTop(access.value + 1);
			transition = NativeBlockTransition::SameWindow;
			break;
		}
		case NativeBlockExit::ReadIndex: {
			const auto access = exit->operands.table;
			const Value base = frame->registers.get(access.receiver);
			const Value key = readRK(*frame->executionImage, frame->registers, access.key);
			frame->registers.set(access.value, valueIsString(key)
				? cpu.loadNativeTableField(exit->tableReadCache, base, asStringId(key))
				: cpu.loadTableIndex(base, key));
			frame->extendTop(access.value + 1);
			transition = NativeBlockTransition::SameWindow;
			break;
		}
		case NativeBlockExit::ReadInteger: {
			const auto access = exit->operands.table;
			frame->registers.set(access.value, cpu.loadTableIntegerIndex(frame->registers.get(access.receiver), access.key));
			frame->extendTop(access.value + 1);
			transition = NativeBlockTransition::SameWindow;
			break;
		}
		case NativeBlockExit::WriteField:
		case NativeBlockExit::WriteIndex: {
			const auto access = exit->operands.table;
			const Value base = frame->registers.get(access.receiver);
			const bool field = exit->exit == NativeBlockExit::WriteField;
			const Value key = field
				? frame->executionImage->constPool.get(access.key)
				: readRK(*frame->executionImage, frame->registers, access.key);
			const Value value = readRK(*frame->executionImage, frame->registers, access.value);
			if (field || valueIsString(key)) {
				const auto prediction = exit->tableStore;
				void* const source = *prediction.sourceEntry;
				int slot = prediction.slot;
				cpu.storeTableFieldIndexCached(slot, base, asStringId(key), value);
				// Physical table writes can retire their executing RAM source.
				// Only a still-published entry owns this descriptor afterward.
				if (slot != prediction.slot && *prediction.sourceEntry == source) exit->tableStore.slot = slot;
			} else cpu.storeTableIndex(base, key, value);
			break;
		}
		case NativeBlockExit::WriteInteger: {
			const auto& access = exit->operands.table;
			cpu.storeTableIntegerIndex(frame->registers.get(access.receiver), access.key,
				readRK(*frame->executionImage, frame->registers, access.value));
			break;
		}
		case NativeBlockExit::ReadMemory:
		case NativeBlockExit::WriteMemory:
		case NativeBlockExit::WriteWords: {
			const auto& access = exit->operands.memory;
			const u32 address = wordOperand(readRK(*frame->executionImage, frame->registers, access.address)) + access.displacement;
			if (exit->exit == NativeBlockExit::ReadMemory)
				cpu.executeMemoryLoad(*frame, access.slot, access.format, address);
			else if (exit->exit == NativeBlockExit::WriteMemory)
				cpu.executeMemoryStore(*frame, access.slot, access.format, address);
			else
				cpu.executeWordStores(*frame, address, access.slot, access.wordCount);
			transition = NativeBlockTransition::Redispatch;
			break;
		}
		case NativeBlockExit::AllocateTable: {
			const auto& allocation = exit->operands.allocation;
			const int a = allocation.result, array = allocation.arraySize;
			// A ROM recipe stays resident across allocation and watched RAM writes.
			auto* record = exit->recordConstructor;
			auto table = cpu.createTable(array, allocation.hashSize);
			frame->registers.set(a, valueTable(table.address()));
			cpu.instructionBudgetRemaining -= 2 * static_cast<int>(table.storedSlotCount()) - array;
			frame->extendTop(a + 1);
			if (record) {
				const int fieldCycles = BASE_CYCLES[static_cast<u8>(OpCode::SETFIELD)];
				const int fields = static_cast<int>(record->count);
				// The final store may exhaust the grant, but every store must
				// begin with positive budget. Otherwise use the original PCs.
				if (cpu.instructionBudgetRemaining > (fields - 1) * fieldCycles
					&& record->requiredSlots <= static_cast<u32>(frame->stackCapacity())) {
					std::array<Value, TABLE_RECORD_FIELDS_MAX> values;
					u32 present = 0;
					for (int field = 0; field < fields; ++field) {
						values[field] = readRK(*frame->executionImage, frame->registers, record->operands[field]);
						present |= static_cast<u32>(!isNil(values[field])) << field;
					}
					if (present)
						table.fillStringRecord(record->layoutFor(present), std::span(record->keys).first(fields),
							std::span(values).first(fields));
					cpu.instructionBudgetRemaining -= fields * fieldCycles;
					cpu.m_currentInstructionPc = record->lastInstructionPc;
					cpu.lastPc = record->lastWordPc;
					frame->writeControl(FrameField::Pc, record->nextPc);
					continuation = record->continuation[run->cartridgeSlot];
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
					state.diagnosticOpcodes.setfield += record->count;
#endif
				}
			}
			break;
		}
		case NativeBlockExit::Continue:
		case NativeBlockExit::ScalarBoundary:
		case NativeBlockExit::Count:
			BMSX_UNREACHABLE();
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
				|| cpu.retargetsHaltedFrame(thread, depth)
				|| thread.stackRequiresScalar()) {
#if defined(BMSX_NATIVE_GATE_PROFILE)
				++gateProfile.returns;
#endif
				return nullptr;
			}
			thread.recordNativeWrites(cpu.m_memory.ramWriteWatches());
			state.bindStack(thread);
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
