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
	admit(byteCount, root0, root1, root2, growingStack);
	m_trackedBytes += byteCount;
}

bool LuaHeap::admit(size_t byteCount, Value root0, Value root1, Value root2, Thread* growingStack) {
#if defined(BMSX_GC_STRESS)
	stressHeapAllocation(*this);
#endif
	const size_t limit = capacity();
	size_t nextBytes = m_trackedBytes + byteCount;
	const bool exhausted = nextBytes > limit;
	if (exhausted) {
		collectRuntime(root0, root1, root2, growingStack);
	} else if (nextBytes > m_nextCollectionBytes) {
		const size_t work = m_cpu.stepHeap(root0, root1, root2, growingStack);
		m_cpu.instructionBudgetRemaining -= static_cast<int>(work);
		creditStep(work);
	}
	nextBytes = m_trackedBytes + byteCount;
	if (nextBytes > limit) throw LuaOutOfMemorySignal{};
	return exhausted;
}

u32 LuaHeap::allocateRecord(u32 bytes, bool owned, u32 backingBytes, u32 backingField,
	Value root0, Value root1, Value root2) {
	const size_t charged = heapAllocationBytes(bytes) + (backingBytes ? heapAllocationBytes(backingBytes) : 0u);
	const bool collected = admit(charged, root0, root1, root2, nullptr);
	auto& arena = m_cpu.heapAllocator();
	for (int attempt = collected ? 1 : 0; attempt != 2; ++attempt) {
		if (m_trackedBytes + charged <= capacity()) {
			const u32 address = arena.allocate(bytes, owned);
			if (address) {
				const u32 backing = backingBytes ? arena.allocate(backingBytes, true) : 0u;
				if (!backingBytes || backing) {
					if (backingField) m_cpu.memory().writeRamRecordWord(address + backingField, backing);
					m_trackedBytes += charged;
					return address;
				}
				arena.free(address);
			}
		}
		if (attempt == 0) collectRuntime(root0, root1, root2);
	}
	throw LuaOutOfMemorySignal{};
}

void LuaHeap::allocateCaptureCells(size_t closureBytes, std::span<u32> addresses) {
	const size_t charged = closureBytes + addresses.size() * UPVALUE_HEAP_BYTES;
	const bool collected = admit(charged, valueNil(), valueNil(), valueNil(), nullptr);
	auto& arena = m_cpu.heapAllocator();
	for (int attempt = collected ? 1 : 0; attempt != 2; ++attempt) {
		size_t count = 0;
		if (m_trackedBytes + charged <= capacity()) {
			for (; count < addresses.size(); ++count) {
				// The open-list descriptor owns the cell until frames are physical.
				const u32 address = arena.allocate(UPVALUE_HEAP_BYTES, true);
				if (!address) break;
				addresses[count] = address;
			}
			if (count == addresses.size()) {
				auto& memory = m_cpu.memory();
				for (u32 address : addresses) {
					memory.writeRamRecordWord(address, UPVALUE_RECORD_KIND);
					memory.writeRamRecordWord(address + 4, 0);
					memory.writeRamRecordWord(address + 8, 0);
					memory.writeRamRecordWord(address + 12, 0);
				}
				m_trackedBytes += charged;
				return;
			}
		}
		while (count != 0) arena.free(addresses[--count]);
		if (attempt == 0) collectRuntime();
	}
	throw LuaOutOfMemorySignal{};
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
