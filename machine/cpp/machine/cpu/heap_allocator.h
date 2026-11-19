#pragma once

#include <array>
#include <bit>
#include <cstddef>

#include "common/primitives.h"

namespace bmsx {

class Memory;

// Private management-area ranges not used by the allocator's page index.
inline constexpr u32 HEAP_STRING_METADATA_OFFSET = 0x300u;
inline constexpr u32 HEAP_COLLECTION_TARGET_OFFSET = 0x340u;
inline constexpr u32 HEAP_GC_CONTROL_OFFSET = 0x344u;

// Requests up to half a page share 4 KB pages of one size class: multiples of
// 8 bytes through 64, then four classes per doubling. Larger requests take the
// highest fitting run of whole pages.
inline constexpr u32 HEAP_SMALL_LIMIT = 2048u;
inline constexpr std::array<u16, 28> HEAP_CLASS_BYTES{
	8, 16, 24, 32, 40, 48, 56, 64,
	80, 96, 112, 128, 160, 192, 224, 256,
	320, 384, 448, 512, 640, 768, 896, 1024,
	1280, 1536, 1792, 2048,
};

constexpr u32 heapClassIndex(u32 byteCount) {
	if (byteCount <= 64u) return ((byteCount + 7u) >> 3) - 1u;
	// Requests above 64 bytes use four size classes per doubling.
	const u32 ceilingShift = 32u - static_cast<u32>(std::countl_zero(byteCount - 1u));
	const u32 stepShift = ceilingShift - 3u;
	const u32 quarter = (byteCount - (1u << (ceilingShift - 1u)) + (1u << stepShift) - 1u) >> stepShift;
	return 8u + (ceilingShift - 7u) * 4u + quarter - 1u;
}
u32 heapAllocationBytes(u32 byteCount);

// Owns the non-moving language-heap allocator whose entire state lives in the
// runtime management area. Pointers read back from RAM are guest-writable and
// are validated before use; a broken invariant fails as an unsatisfied request.
class HeapAllocator {
public:
	explicit HeapAllocator(Memory& memory);

	u32 managementOffset() const { return m_management; }
	void reset(u32 floorAddress);
	// Raising the floor is refused while an allocated page lies below it.
	bool setFloor(u32 floorAddress);
	u32 floorAddress() const;
	u32 capacityBytes() const;
	u32 occupiedBytes() const;
	// The record port supplies an aligned physical slot offset.
	bool isIssuedObjectSlot(u32 offset, u32 sizeClass) const;
	// Returns the guest address of the allocation, or 0 when no slot or page run fits.
	u32 allocate(u32 byteCount, bool owned);
	void free(u32 address);

	// Sweep only independently allocated records. Each issued slot is a visit,
	// including a vacant one. Owned blocks are released by their record.
	// The visitor returns charged work, negated when it releases the record.
	using SweepVisitor = i32 (*)(void*, u32);
	void beginObjectSweep();
	bool objectSweepActive() const;
	size_t sweepObjects(size_t allowance, void* context, SweepVisitor visit);
	void visitObjectRecords(void* context, SweepVisitor visit) const;

private:
	size_t walkObjectPages(u32& page, size_t allowance, void* context, SweepVisitor visit) const;
	u32 allocateRun(u32 byteCount, bool owned);
	i32 takeTopPage();
	i32 takeTopRun(u32 pages);
	void unlinkPartial(u32 head, u32 links);
	void setPreviousPartial(u32 pageLink, u32 previous);
	void releasePages(u32 first, u32 end);
	void setAvailable(u32 first, u32 end, bool available);
	bool isAvailable(u32 page) const;
	u32 floorPage() const;
	u32 pageForFloor(u32 address) const;
	u32 partialHead(bool owned, u32 classIndex) const;
	u32 entry(u32 page) const;

	Memory& m_memory;
	u32 m_management;
	u32 m_pageLimit;
	u32 m_minimumFloorPage;
	u32 m_lastAvailableMask;
};

} // namespace bmsx
