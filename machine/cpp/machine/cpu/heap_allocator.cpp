#include "machine/cpu/heap_allocator.h"

#include "machine/memory/memory.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {
namespace {
constexpr u32 PAGE_MASK = HEAP_PAGE_SIZE - 1u;
// Stock firmware diagnostic, dlmalloc's word after floor, limit and segment.
constexpr u32 ARENA_STATE_OFFSET = 0x400u;
constexpr u32 ARENA_OCCUPIED_OFFSET = 24u + 33u * 8u + 32u * 4u + 12u;
}

HeapAllocator::HeapAllocator(Memory& memory)
	: m_memory(memory)
	, m_management((static_cast<u32>(memory.ramByteCount()) & ~PAGE_MASK) - RUNTIME_MANAGEMENT_SIZE) {
}

u32 HeapAllocator::stateOffset() const { return m_management + ARENA_STATE_OFFSET; }
u32 HeapAllocator::floorAddress() const { return m_memory.ramBusEnd(); }
u32 HeapAllocator::capacityBytes() const { return RAM_BASE + m_management - floorAddress(); }
u32 HeapAllocator::occupiedBytes() const { return m_memory.readRamRecordWord(stateOffset() + ARENA_OCCUPIED_OFFSET); }

} // namespace bmsx
