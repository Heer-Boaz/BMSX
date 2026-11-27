#include "machine/cpu/gc_heap.h"

namespace bmsx {

GcHeap::GcHeap(CPU& cpu, LuaHeap& budget, Memory& memory, HeapAllocator& arena, StringPool& strings)
	: budget(budget), memory(memory), arena(arena)
	, m_cpu(cpu), m_stringPool(strings)
	, m_controlOffset(arena.managementOffset() + HEAP_GC_CONTROL_OFFSET) {}

void GcHeap::enqueue(u32 address, u32 link, u32 queue) {
	const u32 previous = indexWord(queue);
	const u32 otherBits = link == GC_RECORD_LINK ? memory.readRamRecordWord(address + link) & ~GC_GRAY_INDEX_MASK : 0u;
	const u32 head = (address & GC_RECORD_MASK) >> GC_RECORD_SHIFT;
	memory.writeRamRecordWord(address + link, otherBits | previous);
	color(address, 2);
	memory.writeRamRecordWord(m_controlOffset + queue, head);
}

} // namespace bmsx
