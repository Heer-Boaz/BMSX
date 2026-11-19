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
	// its charged delta is relative to the capacity on entry, even on failure.
	bool admit(
		size_t byteCount,
		Value root0 = valueNil(),
		Value root1 = valueNil(),
		Value root2 = valueNil(),
		Thread* growingStack = nullptr
	);
	// A record with optional separately allocated backing. Record and backing
	// are charged together, after both allocations are admitted.
	u32 allocateRecord(u32 bytes, bool owned, u32 backingBytes, u32 backingField, Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil());
	u32 allocateStack(u32 bytes, Thread* thread, Value root);
	// Admit the closure and its new cells before publishing any frame link.
	u32 allocateClosureRecord(u32 captures, bool latched = false, std::span<u32> cells = {});
	void collectRuntime(Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil(), Thread* growingStack = nullptr);
	bool stepRuntime();
	// Completed table-storage work consumes the current run's transient grant.
	void accountTableStorageWork(size_t valueSlots);
	void finishCollection();
	size_t usedBytes() const;
	u32 collectionTarget() const;
	void setCollectionTarget(u32 bytes);
	size_t capacity() const;

private:
	void creditStep(size_t work);
	static constexpr size_t MIN_COLLECTION_BYTES = 1024 * 1024;

	CPU& m_cpu;
	const u32 m_targetAddress;
};

} // namespace bmsx
