#pragma once

#include <cstdint>
#include <string>
#include <string_view>

#include "machine/memory/map.h"

namespace bmsx {

class Memory;

struct StringHandleEntry {
	uint32_t addr = 0;
	uint32_t len = 0;
	uint32_t flags = 0;
	uint32_t gen = 0;
};

struct StringHandleTableState {
	uint32_t nextHandle = 0;
	uint32_t generation = 0;
	uint32_t heapUsedBytes = 0;
};

class StringHeap {
public:
	explicit StringHeap(Memory& memory);
	uint32_t allocate(uint32_t length);
	void reset();
	void restoreState(uint32_t usedBytes);
	uint32_t usedBytes() const;

private:
	Memory& m_memory;
	uint32_t m_cursor = STRING_HEAP_BASE;
};

class StringHandleTable {
public:
	explicit StringHandleTable(Memory& memory);

	void reserveHandles(uint32_t minHandle);
	void beginNewGeneration(bool resetHeap);
	void reset();
	StringHandleTableState captureState() const;
	void restoreState(const StringHandleTableState& state);
	uint32_t allocateHandle(std::string_view text, uint32_t flags = 0);
	void writeEntry(uint32_t id, uint32_t addr, uint32_t len, uint32_t flags, uint32_t gen);
	StringHandleEntry readEntry(uint32_t id) const;
	std::string readText(const StringHandleEntry& entry) const;
	uint32_t usedHeapBytes() const;

private:
	Memory& m_memory;
	StringHeap m_heap;
	uint32_t m_nextHandle = 0;
	uint32_t m_generation = 0;
};

} // namespace bmsx
