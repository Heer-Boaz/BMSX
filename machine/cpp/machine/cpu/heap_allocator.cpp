#include "machine/cpu/heap_allocator.h"

#include <algorithm>
#include <cstring>

#include "machine/memory/memory.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {
namespace {
constexpr u32 PAGE_MASK = HEAP_PAGE_SIZE - 1u;
static_assert(HEAP_PAGE_SIZE == BMSX_DLMALLOC_PAGE_BYTES);
static_assert(MAPPED_PAGE_BYTE_SHIFT == BMSX_DLMALLOC_WATCH_SHIFT);
static_assert(MAPPED_WATCH_HISTORY_CLEAN == BMSX_DLMALLOC_HISTORY_CLEAN);
}

HeapAllocator::HeapAllocator(Memory& memory)
	: m_memory(memory)
	, m_management((static_cast<u32>(memory.ramByteCount()) & ~PAGE_MASK) - RUNTIME_MANAGEMENT_SIZE)
	, m_arena{memory.ramData(), m_management + BMSX_DLMALLOC_STATE_OFFSET, memory.ramWriteWatches().groupData()} {
	reset(DYNAMIC_RAM_BASE);
}

u32 HeapAllocator::floorOffset(u32 address) const {
	const u32 offset = std::min(std::max(address, DYNAMIC_RAM_BASE) - RAM_BASE, m_management);
	return (offset + PAGE_MASK) & ~PAGE_MASK;
}

void HeapAllocator::reset(u32 floorAddress) {
	std::memset(m_memory.ramData() + m_management, 0, RUNTIME_MANAGEMENT_SIZE);
	m_memory.invalidateRamWrite(m_management, RUNTIME_MANAGEMENT_SIZE);
	const u32 floor = floorOffset(floorAddress);
	bmsx_dlmalloc_reset(m_arena, floor, m_management);
	publishFloor(floor);
}

bool HeapAllocator::setFloor(u32 floorAddress) {
	const u32 floor = floorOffset(floorAddress);
	if (!bmsx_dlmalloc_set_floor(m_arena, floor)) return false;
	publishFloor(floor);
	return true;
}

void HeapAllocator::publishFloor(u32 offset) {
	m_memory.setRamBusEnd(RAM_BASE + offset);
}

u32 HeapAllocator::floorAddress() const { return m_memory.ramBusEnd(); }
u32 HeapAllocator::capacityBytes() const { return RAM_BASE + m_management - floorAddress(); }
u32 HeapAllocator::occupiedBytes() const { return bmsx_dlmalloc_occupied_bytes(m_arena); }
u32 HeapAllocator::allocationBytes(u32 address) const { return bmsx_dlmalloc_allocation_bytes(m_arena, address - RAM_BASE); }
bool HeapAllocator::issuedObjectStart(u32 offset) const { return bmsx_dlmalloc_is_object(m_arena, offset) != 0; }

u32 HeapAllocator::allocate(u32 byteCount, bool owned) {
	const u32 offset = bmsx_dlmalloc_allocate(m_arena, byteCount, !owned);
	return offset != 0u ? RAM_BASE + offset : 0u;
}

void HeapAllocator::free(u32 address) { bmsx_dlmalloc_free(m_arena, address - RAM_BASE); }
u32 HeapAllocator::reserveBacking(u32 address, u32 bytes) {
	const u32 offset = bmsx_dlmalloc_reserve_backing(m_arena, address - RAM_BASE, bytes);
	return offset != 0u ? RAM_BASE + offset : 0u;
}
u32 HeapAllocator::resizeBacking(u32 address, u32 bytes) {
	const u32 offset = bmsx_dlmalloc_resize_backing(m_arena, address - RAM_BASE, bytes);
	return offset != 0u ? RAM_BASE + offset : 0u;
}
void HeapAllocator::shrinkBacking(u32 address, u32 retainedBytes) {
	bmsx_dlmalloc_shrink(m_arena, address - RAM_BASE, retainedBytes);
}

} // namespace bmsx
