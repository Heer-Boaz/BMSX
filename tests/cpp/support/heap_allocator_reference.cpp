#include "machine/cpu/heap_allocator.h"

#include <algorithm>

#include "common/dlmalloc/dlmalloc.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {

namespace {
constexpr u32 PAGE_MASK = HEAP_PAGE_SIZE - 1u;
static_assert(HEAP_PAGE_SIZE == BMSX_DLMALLOC_PAGE_BYTES);
static_assert(MAPPED_PAGE_BYTE_SHIFT == BMSX_DLMALLOC_WATCH_SHIFT);
static_assert(MAPPED_WATCH_HISTORY_CLEAN == BMSX_DLMALLOC_HISTORY_CLEAN);

bmsx_dlmalloc_arena arena(Memory& memory, u32 state) {
	return {memory.ramData(), state, memory.ramWriteWatches().groupData()};
}
}

u32 HeapAllocator::floorOffset(u32 address) const {
	const u32 offset = std::min(std::max(address, DYNAMIC_RAM_BASE) - RAM_BASE, m_management);
	return (offset + PAGE_MASK) & ~PAGE_MASK;
}

bool HeapAllocator::setFloor(u32 floorAddress) {
	const u32 floor = floorOffset(floorAddress);
	if (!bmsx_dlmalloc_set_floor(arena(m_memory, stateOffset()), floor)) return false;
	m_memory.setRamBusEnd(RAM_BASE + floor);
	return true;
}

bool HeapAllocator::issuedObjectStart(u32 offset) const {
	return bmsx_dlmalloc_is_object(arena(m_memory, stateOffset()), offset) != 0;
}

u32 HeapAllocator::allocationBytes(u32 address) const { return bmsx_dlmalloc_allocation_bytes(arena(m_memory, stateOffset()), address - RAM_BASE); }
u32 HeapAllocator::allocate(u32 byteCount, bool owned) {
	const u32 offset = bmsx_dlmalloc_allocate(arena(m_memory, stateOffset()), byteCount, !owned);
	return offset != 0u ? RAM_BASE + offset : 0u;
}

void HeapAllocator::free(u32 address) { bmsx_dlmalloc_free(arena(m_memory, stateOffset()), address - RAM_BASE); }
u32 HeapAllocator::reserveBacking(u32 address, u32 bytes) {
	const u32 offset = bmsx_dlmalloc_reserve_backing(arena(m_memory, stateOffset()), address - RAM_BASE, bytes);
	return offset != 0u ? RAM_BASE + offset : 0u;
}
u32 HeapAllocator::resizeBacking(u32 address, u32 bytes) {
	const u32 offset = bmsx_dlmalloc_resize_backing(arena(m_memory, stateOffset()), address - RAM_BASE, bytes);
	return offset != 0u ? RAM_BASE + offset : 0u;
}
void HeapAllocator::shrinkBacking(u32 address, u32 retainedBytes) {
	bmsx_dlmalloc_shrink(arena(m_memory, stateOffset()), address - RAM_BASE, retainedBytes);
}

} // namespace bmsx
