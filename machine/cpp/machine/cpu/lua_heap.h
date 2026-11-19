#pragma once

#include <cstddef>

#include "common/primitives.h"
#include "machine/cpu/value.h"

namespace bmsx {

class CPU;
struct Thread;

struct LuaHeapState {
	size_t trackedBytes = 0;
	size_t nextCollectionBytes = 0;
};

class LuaHeap {
public:
	LuaHeapState captureState() const { return {m_trackedBytes, m_nextCollectionBytes}; }
	void restoreState(const LuaHeapState& state) {
		m_trackedBytes = state.trackedBytes;
		m_nextCollectionBytes = state.nextCollectionBytes;
	}
	explicit LuaHeap(CPU& cpu);

	// A stack-growth admission excludes that same allocation from GC shrinking;
	// its charged delta is relative to the capacity on entry, even on failure.
	void reserve(
		size_t byteCount,
		Value root0 = valueNil(),
		Value root1 = valueNil(),
		Value root2 = valueNil(),
		Thread* growingStack = nullptr
	);
	// Physical backing for a record. extraBytes charges its still-host-backed
	// header without publishing that charge on an unsuccessful allocation.
	u32 allocateRecord(u32 bytes, bool owned, size_t extraBytes, Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil());
	void collectRuntime(Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil(), Thread* growingStack = nullptr);
	bool stepRuntime();
	void restoreAllocate(size_t byteCount) { m_trackedBytes += byteCount; }
	// Completed table-storage work consumes the current run's transient grant.
	void accountTableStorageWork(size_t valueSlots);
	void release(size_t byteCount) { m_trackedBytes -= byteCount; }
	void adjustForRestore(size_t previousBytes, size_t restoredBytes);
	void finishCollection();
	size_t usedBytes() const { return m_trackedBytes; }
	size_t capacity() const;

private:
	bool admit(size_t bytes, Value root0, Value root1, Value root2, Thread*);
	void creditStep(size_t work);
	static constexpr size_t MIN_COLLECTION_BYTES = 1024 * 1024;

	CPU& m_cpu;
	size_t m_trackedBytes = 0;
	size_t m_nextCollectionBytes = MIN_COLLECTION_BYTES;
};

} // namespace bmsx
