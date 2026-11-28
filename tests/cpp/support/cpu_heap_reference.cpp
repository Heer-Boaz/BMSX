#include "machine/cpu/cpu.h"
#include "machine/cpu/upvalue.h"
#include "firmware_heap_layout.h"

#include <algorithm>

namespace bmsx {

CPU::LocalRootsScope::LocalRootsScope(CPU& cpu)
	: m_cpu(&cpu) {
	cpu.m_stringPool.beginLocalRoots();
}

CPU::LocalRootsScope::LocalRootsScope(LocalRootsScope&& other) noexcept
	: m_cpu(other.m_cpu) {
	other.m_cpu = nullptr;
}

CPU::LocalRootsScope::~LocalRootsScope() {
	if (m_cpu) {
		m_cpu->m_stringPool.endLocalRoots();
	}
}

Value CPU::getSystemGlobalByKey(StringId key) const {
	return m_systemGlobalBank.values().get(*m_systemGlobalBank.find(key));
}

Value CPU::getGlobalByKey(StringId key) const {
	const auto slot = m_globalBank.find(key);
	return slot ? m_globalBank.values().get(*slot) : valueNil();
}

void CPU::setGlobalByKey(StringId key, const Value& value) {
	const u32 slot = m_globalBank.registerName(m_heap, key, value);
	m_globalBank.writeSlot(m_heap, slot, value);
}

void CPU::setSystemGlobalByKey(StringId key, const Value& value) {
	const auto slot = m_systemGlobalBank.find(key);
	if (!slot) {
		throw BMSX_RUNTIME_ERROR("System global '" + m_stringPool.toString(key) + "' has no register slot.");
	}
	m_systemGlobalBank.writeSlot(m_heap, *slot, value);
}

void CPU::abortCompletionCall(int frameIndex) {
	if (fixedInterruptActive()) throw BMSX_RUNTIME_ERROR("Fixed execution must retire before replacing code execution.");
	if (static_cast<int>(m_activeThread->frameDepth()) > frameIndex) {
		abortStalledMemoryWrite();
		do {
			auto& frame = *m_activeThread->currentFrame;
			u32 address = frame.readControl(FrameField::OpenHead);
			for (u32 closed = 0u; address != 0u && closed < UPVALUE_CHAIN_LIMIT; ++closed) {
				const u32 cell = address & UPVALUE_ADDRESS_MASK;
				if (m_memory.readRamRecordByte(cell) != UPVALUE_RECORD_KIND || !Upvalue::isOpen(m_memory, cell)) break;
				address = m_memory.readRamRecordWord(cell + UPVALUE_NEXT);
				Upvalue::close(m_memory, cell);
				const auto tag = static_cast<ValueTag>(m_memory.readRamRecordByte(cell + UPVALUE_VALUE_TAG));
				if (valueTagHasGcEdge(tag)) m_heap.writeBarrier(cell, UPVALUE_NEXT);
			}
			frame.writeControl(FrameField::OpenHead, 0u);
			m_activeThread->leaveFrame();
		} while (static_cast<int>(m_activeThread->frameDepth()) > frameIndex);
		resumeFrameBank();
	}
	m_completionValues.clear(0, m_completionValueCount); m_completionValueCount = 0;
}

void CPU::retireThreadView(u32 address) {
	for (auto& view : m_transferViews) {
		if (view.address != address) continue;
		view.select(0u);
		return;
	}
}

void CPU::rebindRelocatedThread(u32 address) {
	visitThreadViews([&](Thread& thread) {
		if (thread.address != address) return;
		thread.bindStack();
	});
}

size_t CPU::collectHeap(Value root0, Value root1, Value root2, u32 growingThread) {
	return m_heap.collect(root0, root1, root2, growingThread);
}

void CPU::chargeCollectionWork(size_t work) {
	if (m_runKind != CpuRunKind::Idle) instructionBudgetRemaining -= GC_WORK_WORD_CYCLES * static_cast<int>(work);
}

size_t CPU::assistAllocation(Value root0, Value root1, Value root2, u32 growingThread, size_t words, const int* sourceBudget) {
	if (m_runKind != CpuRunKind::Idle || sourceBudget) {
		const int remaining = sourceBudget ? *sourceBudget : instructionBudgetRemaining;
		if (remaining < GC_WORK_WORD_CYCLES) return 0;
		words = std::min(words, static_cast<size_t>(remaining / GC_WORK_WORD_CYCLES));
	}
	const size_t work = m_heap.step(root0, root1, root2, growingThread, false, words);
	chargeCollectionWork(work);
	return work;
}

size_t CPU::stepHeap(Value root0, Value root1, Value root2, u32 growingThread) {
	return m_heap.step(root0, root1, root2, growingThread);
}

CPU::LocalRootsScope CPU::acquireLocalRoots() {
	return LocalRootsScope(*this);
}

void CPU::markRootHead(GcHeap& heap) {
	using Field = GcDiagnosticField;
	// Opcode metamethod selectors stay interned independently of guest tables.
	heap.markString(heap.diagnosticWord(Field::Index));
	heap.markString(heap.diagnosticWord(Field::NewIndex));
	heap.markString(heap.diagnosticWord(Field::Length));
	heap.markString(heap.diagnosticWord(Field::Error));
	const u32 faults = heap.diagnosticWord(Field::FaultIds);
	for (u32 reason = 0; reason <= LUA_FAULT_REASON_INDEX_NAN; ++reason)
		if (reason != LUA_FAULT_REASON_EXPLICIT_ERROR) heap.markString(m_memory.readRamRecordWord(faults + reason * sizeof(u32)));
	heap.markValue(valueFromTag(static_cast<ValueTag>(heap.diagnosticWord(Field::StringIndexTag)),
		heap.diagnosticWord(Field::StringIndexWord)));
	if (m_stringComparison.remaining) { heap.markString(m_stringComparison.left); heap.markString(m_stringComparison.right); }
}

void CPU::markScopedRoots(GcHeap& heap) {
	for (size_t scratchIndex = 0; scratchIndex < m_builtinResultScratchIndex; ++scratchIndex) {
		BuiltinResults& scratch = m_builtinResultScratch.get(scratchIndex);
		for (size_t valueIndex = 0; valueIndex < scratch.size(); ++valueIndex) {
			heap.markValue(scratch[valueIndex]);
		}
	}
}

size_t CPU::rootBankEnd(GcRootBank bank) const {
	if (bank == GcRootBank::SystemGlobals) return m_systemGlobalBank.count();
	if (bank == GcRootBank::Globals) return m_globalBank.count();
	if (bank == GcRootBank::Completion) return m_completionValueCount;
	const u32 binding = executionImageBindingOffset(m_heapAllocator.managementOffset(),
		static_cast<i32>(bank) - static_cast<i32>(GcRootBank::Cart0Constants));
	return m_memory.readRamRecordWord(binding + test::FIRMWARE_IMAGE_BINDING_RAM_STRING_END_OFFSET);
}

size_t CPU::markRootBank(GcHeap& heap, GcRootBank bank, size_t& next, size_t end, size_t allowance) {
	const size_t stop = std::min(end, next + allowance);
	const size_t slotsVisited = stop - next;
	if (bank < GcRootBank::SystemConstants) {
		const auto& names = bank == GcRootBank::SystemGlobals ? m_systemGlobalBank : m_globalBank;
		const auto slots = names.values();
		for (; next < stop; ++next) {
			heap.markString(names.name(next));
			heap.markValue(slots.get(next));
		}
		return slotsVisited;
	}
	if (bank == GcRootBank::Completion) {
		for (; next < stop; ++next) heap.markValue(m_completionValues.get(next));
		return slotsVisited;
	}
	const u32 binding = executionImageBindingOffset(m_heapAllocator.managementOffset(),
		static_cast<i32>(bank) - static_cast<i32>(GcRootBank::Cart0Constants));
	const u32 roots = m_memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET);
	size_t marked = 0;
	// A literal bank resumes at a physical ordinal. As in the original
	// compact root scan, only the RAM String roots consume this allowance.
	for (; next < end && marked < allowance; ++next) {
		const StringId id = m_memory.readRamRecordWord(roots + static_cast<u32>(next) * 4u);
		if (!isRamStringId(id)) continue;
		heap.markString(id);
		++marked;
	}
	return marked;
}

void CPU::markRootThreads(GcHeap& heap) {
	heap.markThread(m_rootView.address);
	if (m_activeThread) heap.markThread(m_activeThread->address);
	heap.markThread(m_completionThreadAddress);
	heap.markThread(m_haltedUntilIrqThreadAddress);
}

} // namespace bmsx
