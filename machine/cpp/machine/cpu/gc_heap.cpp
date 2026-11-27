#include "machine/cpu/gc_heap.h"

namespace bmsx {

GcHeap::GcHeap(CPU& cpu, LuaHeap& budget, Memory& memory, HeapAllocator& arena, StringPool& strings)
	: budget(budget), memory(memory), arena(arena)
	, m_cpu(cpu), m_stringPool(strings)
	, m_controlOffset(arena.managementOffset() + HEAP_GC_CONTROL_OFFSET) {}

} // namespace bmsx
