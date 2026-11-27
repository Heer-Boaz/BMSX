#include "machine/cpu/heap_allocator.h"

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
}

u32 HeapAllocator::floorAddress() const { return m_memory.ramBusEnd(); }
u32 HeapAllocator::capacityBytes() const { return RAM_BASE + m_management - floorAddress(); }
u32 HeapAllocator::occupiedBytes() const { return bmsx_dlmalloc_occupied_bytes(m_arena); }
bool HeapAllocator::issuedObjectStart(u32 offset) const { return bmsx_dlmalloc_is_object(m_arena, offset) != 0; }

} // namespace bmsx
