#pragma once

#include <cstddef>
#include <span>

#include "common/primitives.h"
#include "machine/cpu/value.h"

namespace bmsx {

class CPU;
struct Thread;

class LuaHeap {
public:
	explicit LuaHeap(CPU& cpu);

	// A stack-growth admission excludes that same allocation from GC shrinking;
	// its admitted reservation is based on the requested logical bytes.
	bool admit(
		size_t byteCount,
		Value root0 = valueNil(),
		Value root1 = valueNil(),
		Value root2 = valueNil(),
		u32 growingThread = 0u
	);
	// A record with optional separately allocated backing. Record and backing
	// are charged together, after both allocations are admitted.
	u32 allocateRecord(u32 bytes, bool owned, u32 backingBytes, u32 backingField, Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil());
	// A thread reserves its replacement backing, then its owner publishes it.
	u32 allocateStack(u32 bytes, u32 threadAddress, Value root);
	u32 allocateThreadRecord(u32 entry);
	void reserveThreadFrameStorage(u32 address, u32 valueCapacity, u32 frameCapacity, Value root);
	// Admit the closure and its new cells before publishing any frame link.
	u32 allocateClosureRecord(u32 captures, bool latched = false, std::span<u32> cells = {});
	void releaseRecord(u32 address, u32 bytes);
	void replaceRecord(u32 oldAddress, u32 oldBytes, u32 newBytes);
	void collectRuntime(Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil(), u32 growingThread = 0u);
	bool stepRuntime();
	void finishCollection();
	size_t usedBytes() const;
	u32 collectionTarget() const;
	void setCollectionTarget(u32 bytes);
	size_t capacity() const;

private:
	void accountAllocation(u32 bytes);
	void addYoungDebt(u32 bytes);
	void creditStep(size_t work);
	static constexpr size_t MIN_COLLECTION_BYTES = 1024 * 1024;
	static constexpr size_t YOUNG_INTERVAL_BYTES = 128 * 1024;

	CPU& m_cpu;
	const u32 m_targetAddress;
	const u32 m_youngDebtAddress;
	const u32 m_occupiedAddress;
};

} // namespace bmsx
