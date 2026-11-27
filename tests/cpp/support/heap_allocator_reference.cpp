#include "machine/cpu/heap_allocator.h"

#include <algorithm>

#include "machine/memory/memory.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {

namespace {
constexpr u32 PAGE_MASK = HEAP_PAGE_SIZE - 1u;
}

u32 HeapAllocator::floorOffset(u32 address) const {
	const u32 offset = std::min(std::max(address, DYNAMIC_RAM_BASE) - RAM_BASE, m_management);
	return (offset + PAGE_MASK) & ~PAGE_MASK;
}

bool HeapAllocator::setFloor(u32 floorAddress) {
	const u32 floor = floorOffset(floorAddress);
	if (!bmsx_dlmalloc_set_floor(m_arena, floor)) return false;
	m_memory.setRamBusEnd(RAM_BASE + floor);
	return true;
}

u32 HeapAllocator::allocationBytes(u32 address) const { return bmsx_dlmalloc_allocation_bytes(m_arena, address - RAM_BASE); }
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
