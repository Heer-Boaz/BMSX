#include "machine/cpu/lua_heap.h"

#include <algorithm>

#include "machine/cpu/cpu.h"
#include "machine/cpu/errors.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {

LuaHeap::LuaHeap(CPU& cpu, size_t ramByteCount)
	: m_cpu(cpu)
	, m_capacityBytes(ramByteCount - BASE_RAM_USED_SIZE) {
}

void LuaHeap::reserve(
	size_t byteCount,
	Value root0,
	Value root1,
	Value root2
) {
	size_t nextBytes = m_trackedBytes + byteCount;
	if (nextBytes > m_nextCollectionBytes || nextBytes > m_capacityBytes) {
		m_cpu.collectHeap(root0, root1, root2);
		nextBytes = m_trackedBytes + byteCount;
		if (nextBytes > m_capacityBytes) {
			throw LuaOutOfMemorySignal{};
		}
		if (nextBytes > m_nextCollectionBytes) {
			m_nextCollectionBytes = std::max(MIN_COLLECTION_BYTES, nextBytes * 2);
		}
	}
	m_trackedBytes = nextBytes;
}

void LuaHeap::adjustForRestore(size_t previousBytes, size_t restoredBytes) {
	if (restoredBytes > previousBytes) {
		m_trackedBytes += restoredBytes - previousBytes;
	} else {
		m_trackedBytes -= previousBytes - restoredBytes;
	}
}

void LuaHeap::finishCollection(size_t liveBytes) {
	m_trackedBytes = liveBytes;
	m_nextCollectionBytes = std::max(MIN_COLLECTION_BYTES, liveBytes * 2);
	if (liveBytes > m_capacityBytes) {
		throw LuaOutOfMemorySignal{};
	}
}

} // namespace bmsx
