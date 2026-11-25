#pragma once

#include <cstddef>
#include <optional>
#include <span>

#include "common/primitives.h"
#include "machine/cpu/value.h"

namespace bmsx {

class CPU;
struct Thread;
enum class ThreadField : u32;
enum class LuaAllocationRecovery { CurrentOrFresh, Fresh, Exhausted };
enum class LuaAllocationMode { Direct, Scheduled, Retry };

class LuaHeap {
public:
	explicit LuaHeap(CPU& cpu);

	// Admit the logical bytes without publishing the reservation.
	LuaAllocationRecovery admit(
		size_t byteCount,
		Value root0 = valueNil(),
		Value root1 = valueNil(),
		Value root2 = valueNil(),
		u32 growingThread = 0u
	);
	// Run an ordinary assist; a false result means the logical request
	// needs recovery before it can be admitted.
	bool prepareAllocation(size_t byteCount, Value root0, Value root1, Value root2, u32 growingThread = 0u);
	// Admit a positive logical increase without running the collector. The
	// owner commits the increase with its storage mutation.
	bool canAdmitWithoutAssist(size_t byteCount) const noexcept;
	// A record may own two independently allocated backing blocks. They
	// are charged together with the record after the last reservation succeeds.
	u32 allocateRecord(u32 bytes, bool object, u32 backingBytes, u32 backingField, Value root0 = valueNil(), Value root1 = valueNil(),
		Value root2 = valueNil(), std::optional<u32> recordCharge = {}, LuaAllocationMode mode = LuaAllocationMode::Direct,
		u32 secondBytes = 0, u32 secondField = 0);
	// Physical backing can reserve more bytes than the owner's logical increase.
	// Admission does not commit occupancy; the owner publishes its replacement.
	u32 reserveBacking(u32 bytes, u32 logicalBytes, Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil(), u32 growingThread = 0u);
	u32 allocateThreadRecord(u32 entry);
	u32 reserveThreadControls(u32 address, ThreadField field, u32 capacity, u32 previous, Value root);
	void reserveThreadFrameStorage(u32 address, u32 valueCapacity, u32 frameCapacity, Value root);
	// Admit the closure and its new cells before publishing any frame link.
	u32 allocateClosureRecord(u32 captures, bool latched = false, std::span<u32> cells = {});
	void releaseRecord(u32 address, u32 bytes);
	void releaseObject(u32 address, u32 bytes);
	void resizeRecordCharge(u32 oldBytes, u32 newBytes);
	void replaceRecord(u32 oldAddress, u32 oldBytes, u32 newBytes);
	void collectRuntime(Value root0 = valueNil(), Value root1 = valueNil(), Value root2 = valueNil(), u32 growingThread = 0u);
	bool stepRuntime();
	void finishCollection();
	size_t usedBytes() const;
	u32 collectionTarget() const;
	void setCollectionTarget(u32 bytes);
	size_t capacity() const;

private:
	enum class LuaAllocationAssist { None, Step, Limit };
	LuaAllocationAssist allocationAssist(size_t nextBytes) const noexcept;
	u32 reserveRecord(u32 bytes, bool object, u32 backingBytes, u32 backingField, u32 charged, u32 secondBytes, u32 secondField);
	void accountAllocation(u32 bytes);
	void creditStep();
	void assistBeforeReservation(size_t requested);
	static constexpr size_t MIN_COLLECTION_BYTES = 1024 * 1024;

	CPU& m_cpu;
	const u32 m_targetAddress;
	const u32 m_occupiedAddress;
	const u32 m_gcControlAddress;
};

} // namespace bmsx
