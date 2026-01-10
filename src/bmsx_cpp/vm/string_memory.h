#pragma once

#include <cstdint>
#include <string_view>

#include "memory_map.h"

namespace bmsx {

class VmMemory;

struct StringHandleEntry {
	uint32_t addr = 0;
	uint32_t len = 0;
	uint32_t flags = 0;
	uint32_t gen = 0;
};

class StringHeap {
public:
	explicit StringHeap(VmMemory& memory);
	uint32_t allocate(uint32_t length);
	void reset();

private:
	VmMemory& m_memory;
	uint32_t m_cursor = STRING_HEAP_BASE;
};

class StringHandleTable {
public:
	explicit StringHandleTable(VmMemory& memory);

	void reserveHandles(uint32_t minHandle);
	void beginNewGeneration(bool resetHeap);
	uint32_t allocateHandle(std::string_view text, uint32_t flags = 0);
	void writeEntry(uint32_t id, uint32_t addr, uint32_t len, uint32_t flags, uint32_t gen);

private:
	VmMemory& m_memory;
	StringHeap m_heap;
	uint32_t m_nextHandle = 0;
	uint32_t m_generation = 0;
};

} // namespace bmsx
