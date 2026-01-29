#include "string_memory.h"
#include "memory.h"

#include <stdexcept>

namespace bmsx {

StringHeap::StringHeap(Memory& memory)
	: m_memory(memory) {
}

uint32_t StringHeap::allocate(uint32_t length) {
	const uint32_t addr = m_cursor;
	const uint32_t next = addr + length;
	if (next > STRING_HEAP_BASE + STRING_HEAP_SIZE) {
		throw std::runtime_error("[StringHeap] Out of heap memory.");
	}
	m_cursor = next;
	return addr;
}

void StringHeap::reset() {
	m_cursor = STRING_HEAP_BASE;
}

StringHandleTable::StringHandleTable(Memory& memory)
	: m_memory(memory)
	, m_heap(memory) {
}

void StringHandleTable::reserveHandles(uint32_t minHandle) {
	if (minHandle > STRING_HANDLE_COUNT) {
		throw std::runtime_error("[StringHandleTable] Reserve exceeds handle capacity.");
	}
	if (minHandle > m_nextHandle) {
		m_nextHandle = minHandle;
	}
}

void StringHandleTable::beginNewGeneration(bool resetHeap) {
	m_generation += 1;
	if (resetHeap) {
		m_heap.reset();
	}
}

uint32_t StringHandleTable::allocateHandle(std::string_view text, uint32_t flags) {
	if (m_nextHandle >= STRING_HANDLE_COUNT) {
		throw std::runtime_error("[StringHandleTable] Out of string handles.");
	}
	const uint32_t addr = m_heap.allocate(static_cast<uint32_t>(text.size()));
	m_memory.writeBytes(addr, reinterpret_cast<const u8*>(text.data()), text.size());
	const uint32_t id = m_nextHandle;
	writeEntry(id, addr, static_cast<uint32_t>(text.size()), flags, m_generation);
	m_nextHandle += 1;
	return id;
}

void StringHandleTable::writeEntry(uint32_t id, uint32_t addr, uint32_t len, uint32_t flags, uint32_t gen) {
	const uint32_t entryAddr = STRING_HANDLE_TABLE_BASE + id * STRING_HANDLE_ENTRY_SIZE;
	m_memory.writeU32(entryAddr, addr);
	m_memory.writeU32(entryAddr + 4, len);
	m_memory.writeU32(entryAddr + 8, flags);
	m_memory.writeU32(entryAddr + 12, gen);
}

} // namespace bmsx
