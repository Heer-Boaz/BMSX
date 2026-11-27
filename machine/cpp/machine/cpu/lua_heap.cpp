#include "machine/cpu/lua_heap.h"

#include "machine/cpu/cpu.h"

namespace bmsx {

LuaHeap::LuaHeap(CPU& cpu)
	: m_cpu(cpu), m_targetAddress(cpu.heapAllocator().managementOffset() + HEAP_COLLECTION_TARGET_OFFSET),
	  m_occupiedAddress(cpu.heapAllocator().managementOffset() + HEAP_LOGICAL_OCCUPIED_OFFSET),
	  m_gcControlAddress(cpu.heapAllocator().managementOffset() + HEAP_GC_CONTROL_OFFSET) {
}

u32 LuaHeap::collectionTarget() const {
	return m_cpu.memory().readRamRecordWord(m_targetAddress);
}

size_t LuaHeap::usedBytes() const {
	return m_cpu.memory().readRamRecordWord(m_occupiedAddress);
}

size_t LuaHeap::capacity() const {
	return m_cpu.heapAllocator().capacityBytes();
}

} // namespace bmsx
