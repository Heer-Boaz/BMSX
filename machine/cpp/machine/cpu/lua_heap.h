#pragma once

#include <cstddef>

#include "machine/cpu/value.h"

namespace bmsx {

class CPU;

class LuaHeap {
public:
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
