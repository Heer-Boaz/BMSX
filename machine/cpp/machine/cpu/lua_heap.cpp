#include "machine/cpu/lua_heap.h"

#include <algorithm>

#include "machine/cpu/cpu.h"
#include "machine/cpu/errors.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {

#if defined(BMSX_GC_STRESS)
// Defined by the stress runner. Only its allocator translation unit uses this
// seam; ordinary cores contain neither a callback nor a runtime mode check.
void stressHeapAllocation(LuaHeap& heap);
#endif

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
#if defined(BMSX_GC_STRESS)
	stressHeapAllocation(*this);
#endif
	size_t nextBytes = m_trackedBytes + byteCount;
	if (nextBytes > m_capacityBytes) {
		collectRuntime(root0, root1, root2);
	} else if (nextBytes > m_nextCollectionBytes) {
		m_cpu.instructionBudgetRemaining -= static_cast<int>(m_cpu.stepHeap(root0, root1, root2));
		if (m_cpu.collecting()) m_nextCollectionBytes = m_trackedBytes + GC_ASSIST_BYTES;
	}
	nextBytes = m_trackedBytes + byteCount;
	if (nextBytes > m_capacityBytes) throw LuaOutOfMemorySignal{};
	m_trackedBytes = nextBytes;
}

void LuaHeap::collectRuntime(Value root0, Value root1, Value root2) {
	m_cpu.instructionBudgetRemaining -= static_cast<int>(m_cpu.collectHeap(root0, root1, root2));
}

void LuaHeap::accountTableStorageWork(size_t valueSlots) {
	m_cpu.instructionBudgetRemaining -= static_cast<int>(valueSlots);
}

void LuaHeap::adjustForRestore(size_t previousBytes, size_t restoredBytes) {
	if (restoredBytes > previousBytes) {
		m_trackedBytes += restoredBytes - previousBytes;
	} else {
		m_trackedBytes -= previousBytes - restoredBytes;
	}
}

void LuaHeap::finishCollection() {
	const size_t liveBytes = m_trackedBytes;
	m_nextCollectionBytes = std::max(liveBytes + GC_ASSIST_BYTES,
		std::min(m_capacityBytes - m_capacityBytes / 8, std::max(MIN_COLLECTION_BYTES, liveBytes * 2)));
}

} // namespace bmsx
