#pragma once

#include "common/primitives.h"

namespace bmsx {

class Memory;

// RAM management ranges owned by the runtime, independent of allocator bins.
inline constexpr u32 HEAP_STRING_METADATA_OFFSET = 0x300u;
inline constexpr u32 HEAP_COLLECTION_TARGET_OFFSET = 0x340u;
inline constexpr u32 HEAP_LOGICAL_OCCUPIED_OFFSET = 0x3f0u;
inline constexpr u32 HEAP_STRING_MARK_WORK_OFFSET = 0x3f4u;

// Read-only view of the stock firmware arena. Mutators are test references.
class HeapAllocator {
public:
	explicit HeapAllocator(Memory& memory);

	u32 managementOffset() const { return m_management; }
	u32 stateOffset() const;
	u32 floorOffset(u32 address) const;
	bool setFloor(u32 floorAddress);
	u32 floorAddress() const;
	u32 capacityBytes() const;
	u32 occupiedBytes() const;
	u32 unoccupiedBytes() const { return capacityBytes() - occupiedBytes(); }
	u32 allocationBytes(u32 address) const;
	bool issuedObjectStart(u32 offset) const;
	// Returns the guest address, or zero if no chunk can fit the request.
	u32 allocate(u32 byteCount, bool owned);
	void free(u32 address);
	u32 reserveBacking(u32 address, u32 bytes);
	u32 resizeBacking(u32 address, u32 bytes);
	void shrinkBacking(u32 address, u32 retainedBytes);

private:
	Memory& m_memory;
	u32 m_management;
};

} // namespace bmsx
