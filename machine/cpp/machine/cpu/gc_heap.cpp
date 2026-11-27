#include "machine/cpu/gc_heap.h"

#include "machine/cpu/upvalue.h"

namespace bmsx {

namespace {
constexpr u8 tableRecordKind = static_cast<u8>(ValueTag::Table);
}

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

u32 GcHeap::objectRecordAddress(u32 address, u8 kind) const {
	const u32 offset = address & GC_RECORD_MASK;
	return memory.readRamRecordByte(offset) == kind
		&& arena.issuedObjectStart(offset - GC_OBJECT_PREFIX) ? RAM_BASE + offset : 0u;
}

u32 GcHeap::threadRecordAddress(u32 address) const {
	return objectRecordAddress(address, THREAD_RECORD_KIND);
}

u32 GcHeap::closureRecordAddress(u32 address) const {
	return objectRecordAddress(address, static_cast<u8>(ValueTag::Closure));
}

u32 GcHeap::tableRecordAddress(u32 address) const {
	return objectRecordAddress(address, tableRecordKind);
}

u32 GcHeap::cellRecordAddress(u32 address) const {
	return objectRecordAddress(address, UPVALUE_RECORD_KIND);
}

u32 GcHeap::openCellAddress(u32 address) const {
	const u32 cell = cellRecordAddress(address);
	return cell != 0u && Upvalue::isOpen(memory, cell) ? cell : 0u;
}

} // namespace bmsx
