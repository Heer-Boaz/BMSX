#pragma once

#include <cstddef>

#include "machine/cpu/value.h"

namespace bmsx {

class CPU;

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
	LuaHeap(CPU& cpu, size_t ramByteCount);

	void reserve(
		size_t byteCount,
		Value root0 = valueNil(),
		Value root1 = valueNil(),
		Value root2 = valueNil()
	);
	void restoreAllocate(size_t byteCount) { m_trackedBytes += byteCount; }
	void release(size_t byteCount) { m_trackedBytes -= byteCount; }
	void adjustForRestore(size_t previousBytes, size_t restoredBytes);
	void finishCollection(size_t liveBytes);
	size_t usedBytes() const { return m_trackedBytes; }

private:
	static constexpr size_t MIN_COLLECTION_BYTES = 1024 * 1024;

	CPU& m_cpu;
	const size_t m_capacityBytes;
	size_t m_trackedBytes = 0;
	size_t m_nextCollectionBytes = MIN_COLLECTION_BYTES;
};

} // namespace bmsx
