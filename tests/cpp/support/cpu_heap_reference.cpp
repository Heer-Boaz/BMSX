#include "machine/cpu/cpu.h"
#include "machine/cpu/upvalue.h"
#include "gc_heap_reference.h"
#include "global_bank_reference.h"

namespace bmsx {

Value CPU::getSystemGlobalByKey(StringId key) const {
	return m_systemGlobalBank.values().get(*test::NativeGlobalBankReference::find(m_systemGlobalBank, key));
}

Value CPU::getGlobalByKey(StringId key) const {
	const auto slot = test::NativeGlobalBankReference::find(m_globalBank, key);
	return slot ? m_globalBank.values().get(*slot) : valueNil();
}

void CPU::setGlobalByKey(StringId key, const Value& value) {
	test::GcHeap heap(*this);
	test::NativeGlobalBankReference bank(m_globalBank);
	const u32 slot = bank.registerName(heap, key, value);
	bank.writeSlot(heap, slot, value);
}

void CPU::setSystemGlobalByKey(StringId key, const Value& value) {
	const auto slot = test::NativeGlobalBankReference::find(m_systemGlobalBank, key);
	if (!slot) {
		throw BMSX_RUNTIME_ERROR("System global '" + m_stringPool.toString(key) + "' has no register slot.");
	}
	test::GcHeap heap(*this);
	test::NativeGlobalBankReference(m_systemGlobalBank).writeSlot(heap, *slot, value);
}

void CPU::abortCompletionCall(int frameIndex) {
	if (fixedInterruptActive()) throw BMSX_RUNTIME_ERROR("Fixed execution must retire before replacing code execution.");
	if (static_cast<int>(m_activeThread->frameDepth()) > frameIndex) {
		test::GcHeap heap(*this);
		abortStalledMemoryWrite();
		do {
			auto& frame = *m_activeThread->currentFrame;
			u32 address = frame.readControl(FrameField::OpenHead);
			for (u32 closed = 0u; address != 0u && closed < UPVALUE_CHAIN_LIMIT; ++closed) {
				const u32 cell = address & RAM_REFERENCE_MASK;
				if (m_memory.readRamRecordByte(cell) != UPVALUE_RECORD_KIND || !Upvalue::isOpen(m_memory, cell)) break;
				address = m_memory.readRamRecordWord(cell + UPVALUE_NEXT);
				Upvalue::close(m_memory, cell);
				const auto tag = static_cast<ValueTag>(m_memory.readRamRecordByte(cell + UPVALUE_VALUE_TAG));
				if (valueTagIsStorageReference(tag)) heap.writeBarrier(cell, UPVALUE_NEXT);
			}
			frame.writeControl(FrameField::OpenHead, 0u);
			m_activeThread->leaveFrame();
		} while (static_cast<int>(m_activeThread->frameDepth()) > frameIndex);
		resumeFrameBank();
	}
	m_completionValues.clear(0, m_completionValueCount); m_completionValueCount = 0;
}

} // namespace bmsx
