#include "machine/cpu/lua_heap.h"

#include <algorithm>

#include "machine/cpu/cpu.h"
#include "machine/cpu/errors.h"

namespace bmsx {

#if defined(BMSX_GC_STRESS)
// Defined by the stress runner. Only its allocator translation unit uses this
// seam; ordinary cores contain neither a callback nor a runtime mode check.
void stressHeapAllocation(LuaHeap& heap);
#endif

LuaHeap::LuaHeap(CPU& cpu)
	: m_cpu(cpu) {
}

void LuaHeap::reserve(
	size_t byteCount,
	Value root0,
	Value root1,
	Value root2,
	Thread* growingStack
) {
#if defined(BMSX_GC_STRESS)
	stressHeapAllocation(*this);
#endif
	const size_t limit = capacity();
	size_t nextBytes = m_trackedBytes + byteCount;
	if (nextBytes > limit) {
		collectRuntime(root0, root1, root2, growingStack);
	} else if (nextBytes > m_nextCollectionBytes) {
		const size_t work = m_cpu.stepHeap(root0, root1, root2, growingStack);
		m_cpu.instructionBudgetRemaining -= static_cast<int>(work);
		creditStep(work);
	}
	nextBytes = m_trackedBytes + byteCount;
	if (nextBytes > limit) throw LuaOutOfMemorySignal{};
	m_trackedBytes = nextBytes;
}

void LuaHeap::collectRuntime(Value root0, Value root1, Value root2, Thread* growingStack) {
	m_cpu.instructionBudgetRemaining -= static_cast<int>(m_cpu.collectHeap(root0, root1, root2, growingStack));
}

bool LuaHeap::stepRuntime() {
	const size_t work = m_cpu.stepHeap(valueNil(), valueNil(), valueNil());
	m_cpu.instructionBudgetRemaining -= static_cast<int>(work);
	creditStep(work);
	return !m_cpu.collecting();
}

void LuaHeap::creditStep(size_t work) {
	if (m_cpu.collecting()) m_nextCollectionBytes = m_trackedBytes + std::max(GC_ASSIST_BYTES, work / 16);
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

size_t LuaHeap::capacity() const {
	return m_cpu.heapAllocator().capacityBytes();
}

void LuaHeap::finishCollection() {
	const size_t liveBytes = m_trackedBytes;
	const size_t limit = capacity();
	m_nextCollectionBytes = std::max(liveBytes + GC_ASSIST_BYTES,
		std::min(limit - limit / 8, std::max(MIN_COLLECTION_BYTES, liveBytes * 2)));
}

} // namespace bmsx
