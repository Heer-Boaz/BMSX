#pragma once

#include <cstddef>
#include <optional>
#include <span>

#include "common/primitives.h"
#include "machine/cpu/value.h"

namespace bmsx {

class CPU;
struct Thread;
enum class LuaAllocationAssist { None, Step, Full };

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
	// An owner whose logical request depends on retained weak values must
	// quote it again after this phase, before checking the final admission.
	LuaAllocationAssist prepareAllocation(size_t byteCount, Value root0, Value root1, Value root2, u32 growingThread = 0u);
	// Admit a positive logical increase without running the collector. The
	// owner commits the increase with its storage mutation.
	bool canAdmitWithoutAssist(size_t byteCount) const noexcept;
	// A record with optional separately allocated backing. Record and backing
	// are charged together, after both allocations are admitted.
	u32 allocateRecord(u32 bytes, bool owned, u32 backingBytes, u32 backingField, Value root0 = valueNil(), Value root1 = valueNil(),
		Value root2 = valueNil(), std::optional<u32> backingCharge = {});
	// Physical backing can reserve more bytes than the owner's logical increase.
	// Admission does not commit occupancy; the owner publishes its replacement.
	u32 reserveBacking(u32 bytes, u32 logicalBytes, Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil(), u32 growingThread = 0u);
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
	LuaAllocationAssist allocationAssist(size_t byteCount) const noexcept;
	void accountAllocation(u32 bytes);
	void creditStep();
	static constexpr size_t MIN_COLLECTION_BYTES = 1024 * 1024;

	CPU& m_cpu;
	const u32 m_targetAddress;
	const u32 m_occupiedAddress;
};

} // namespace bmsx
