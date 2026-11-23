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
inline constexpr u32 HEAP_LOGICAL_OCCUPIED_OFFSET = 0x3f0u;
inline constexpr u32 HEAP_PAGE_ENTRIES = 0x1000u;
inline constexpr u32 HEAP_PAGE_ENTRY_BYTES = 12u;
inline constexpr u32 HEAP_BUMP_SHIFT = 3u;
inline constexpr u32 HEAP_PAGE_LINK_MASK = 0x3ffu;
enum HeapPageKind : u32 { Unused, ObjectSlots, OwnedSlots, ObjectRun, OwnedRun };

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
// A page offset is at most 4095. Rounded-up Q16 reciprocals therefore
// recover the exact quotient at every slot start; multiplication by the class
// stride distinguishes those starts from the intervening byte offsets.
inline constexpr u32 HEAP_SLOT_RECIPROCAL_BITS = 16u;
inline constexpr auto HEAP_CLASS_SLOT_RECIPROCALS = [] {
	std::array<u16, HEAP_CLASS_BYTES.size()> result{};
	for (size_t i = 0; i < result.size(); ++i)
		result[i] = static_cast<u16>(((1u << HEAP_SLOT_RECIPROCAL_BITS) + HEAP_CLASS_BYTES[i] - 1u) / HEAP_CLASS_BYTES[i]);
	return result;
}();

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
// private runtime management area. A bitmap tracks free pages;
// descriptors belong to slab pages and run heads, not to run interiors.
class HeapAllocator {
public:
	explicit HeapAllocator(Memory& memory);

	u32 managementOffset() const { return m_management; }
	u32 pageLimit() const { return m_pageLimit; }
	void reset(u32 floorAddress);
	// Raising the floor is refused while an allocated page lies below it.
	bool setFloor(u32 floorAddress);
	u32 floorAddress() const;
	u32 capacityBytes() const;
	u32 availableWholePages() const;
	u32 claimedWholePages() const;
	// Physical class extents, for diagnostics only.
	u32 occupiedBytes() const;
	// Variable-size records must begin at an issued slot or a run head.
	bool issuedObjectStart(u32 offset) const;
	// Returns the guest address of the allocation, or 0 when no slot or page run fits.
	u32 allocate(u32 byteCount, bool owned);
	void free(u32 address);
	// The owner already retired every reference into the discarded suffix.
	// The retained prefix still occupies a nonempty, whole-page run.
	void trimOwnedRun(u32 address, u32 retainedBytes);

private:
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
