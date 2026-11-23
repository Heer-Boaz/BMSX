#include "machine/cpu/heap_allocator.h"

#include <algorithm>
#include <bit>
#include <cstring>

#include "machine/memory/memory.h"
#include "spec/bmsx/memory_map.h"

namespace bmsx {
namespace {

constexpr u32 CLASS_COUNT = static_cast<u32>(HEAP_CLASS_BYTES.size());
constexpr u32 PAGE_SHIFT = 12u;
constexpr u32 PAGE_MASK = HEAP_PAGE_SIZE - 1u;
constexpr u32 MAX_PAGES = (MAIN_RAM_SIZE - RUNTIME_MANAGEMENT_SIZE) >> PAGE_SHIFT;

// Management-area layout, as byte offsets from its base. Every field is a
// little-endian word in guest RAM; partial-list links store page + 1.
constexpr u32 AVAILABLE_PAGE_COUNT = 0x000u;
constexpr u32 CLAIMED_PAGE_COUNT = 0x004u;
constexpr u32 PARTIAL_HEADS = 0x040u;
constexpr u32 AVAILABLE_PAGES = 0x200u;
static_assert(AVAILABLE_PAGES + ((MAX_PAGES + 31u) >> 5u) * 4u <= HEAP_STRING_METADATA_OFFSET);

// Page entry: word 0 = kind | class << 8 | live << 16; word 1 = free-slot head
// (guest address) or run length. Word 2 packs the bump in units
// of 8 bytes, then the previous and next partial-page links, 10 bits each.
constexpr u32 PREVIOUS_SHIFT = 10u;
constexpr u32 NEXT_SHIFT = 20u;

} // namespace

u32 heapAllocationBytes(u32 byteCount) {
	if (byteCount == 0u) return 0u;
	return byteCount <= HEAP_SMALL_LIMIT
		? HEAP_CLASS_BYTES[heapClassIndex(byteCount)]
		: (byteCount + PAGE_MASK) & ~PAGE_MASK;
}

HeapAllocator::HeapAllocator(Memory& memory)
	: m_memory(memory)
	, m_management((static_cast<u32>(memory.ramByteCount()) & ~PAGE_MASK) - RUNTIME_MANAGEMENT_SIZE)
	, m_pageLimit(std::min(m_management >> PAGE_SHIFT, MAX_PAGES))
	, m_minimumFloorPage(std::min((DYNAMIC_RAM_BASE - RAM_BASE) >> PAGE_SHIFT, m_pageLimit))
	, m_lastAvailableMask((m_pageLimit & 31u) == 0u ? ~0u : ~(~0u << (m_pageLimit & 31u))) {
	reset(DYNAMIC_RAM_BASE);
}

void HeapAllocator::reset(u32 floorAddress) {
	std::memset(m_memory.ramData() + m_management, 0, RUNTIME_MANAGEMENT_SIZE);
	m_memory.invalidateRamWrite(m_management, RUNTIME_MANAGEMENT_SIZE);
	const u32 page = pageForFloor(floorAddress);
	setAvailable(page, m_pageLimit, true);
	m_memory.setRamBusEnd(RAM_BASE + (page << PAGE_SHIFT));
}

bool HeapAllocator::setFloor(u32 floorAddress) {
	const u32 current = floorPage();
	const u32 next = pageForFloor(floorAddress);
	if (next > current) {
		for (u32 page = current; page < next; ++page) {
			if (!isAvailable(page)) return false;
		}
		setAvailable(current, next, false);
	} else if (next < current) {
		setAvailable(next, current, true);
	}
	m_memory.setRamBusEnd(RAM_BASE + (next << PAGE_SHIFT));
	return true;
}

u32 HeapAllocator::floorAddress() const {
	return RAM_BASE + (floorPage() << PAGE_SHIFT);
}

u32 HeapAllocator::capacityBytes() const {
	return (m_pageLimit - floorPage()) << PAGE_SHIFT;
}

u32 HeapAllocator::availableWholePages() const {
	return m_memory.readRamRecordWord(m_management + AVAILABLE_PAGE_COUNT);
}

u32 HeapAllocator::claimedWholePages() const {
	return m_memory.readRamRecordWord(m_management + CLAIMED_PAGE_COUNT);
}

u32 HeapAllocator::occupiedBytes() const {
	u32 bytes = 0;
	for (u32 page = floorPage(); page < m_pageLimit; ++page) {
		const u32 descriptor = entry(page);
		const u32 info = m_memory.readRamRecordWord(descriptor);
		const u32 kind = info & 0xffu;
		if (kind == ObjectSlots || kind == OwnedSlots) {
			bytes += (info >> 16) * HEAP_CLASS_BYTES[(info >> 8) & 0xffu];
		} else if (kind == ObjectRun || kind == OwnedRun) {
			const u32 pages = m_memory.readRamRecordWord(descriptor + 4u);
			bytes += pages << PAGE_SHIFT;
			page += pages - 1u;
		}
	}
	return bytes;
}

bool HeapAllocator::issuedObjectStart(u32 offset) const {
	const u32 page = offset >> PAGE_SHIFT;
	if (page >= m_pageLimit) return false;
	const u32 descriptor = entry(page);
	const u32 info = m_memory.readRamRecordWord(descriptor);
	const u32 within = offset & PAGE_MASK;
	const u32 kind = info & 0xffu;
	if (kind == ObjectRun) return within == 0u;
	const u32 sizeClass = (info >> 8u) & 0xffu;
	if (kind != ObjectSlots) return false;
	const u32 stride = HEAP_CLASS_BYTES[sizeClass];
	const u32 issued = (m_memory.readRamRecordWord(descriptor + 8u) & HEAP_PAGE_LINK_MASK) << HEAP_BUMP_SHIFT;
	const u32 slot = (within * HEAP_CLASS_SLOT_RECIPROCALS[sizeClass]) >> HEAP_SLOT_RECIPROCAL_BITS;
	return within < issued && slot * stride == within;
}

u32 HeapAllocator::allocate(u32 byteCount, bool owned) {
	if (byteCount > HEAP_SMALL_LIMIT) return allocateRun(byteCount, owned);
	const u32 classIndex = heapClassIndex(byteCount);
	const u32 size = HEAP_CLASS_BYTES[classIndex];
	const u32 kindAndClass = (owned ? OwnedSlots : ObjectSlots) | (classIndex << 8);
	const u32 head = partialHead(owned, classIndex);
	u32 page;
	const u32 listed = m_memory.readRamRecordWord(head);
	if (listed == 0u) {
		const i32 taken = takeTopPage();
		if (taken < 0) return 0u;
		page = static_cast<u32>(taken);
		const u32 fresh = entry(page);
		m_memory.writeRamRecordWord(fresh, kindAndClass);
		m_memory.writeRamRecordWord(fresh + 4u, 0u);
		m_memory.writeRamRecordWord(fresh + 8u, 0u);
		m_memory.writeRamRecordWord(head, page + 1u);
	} else {
		page = listed - 1u;
		if (page >= m_pageLimit) return 0u;
	}
	const u32 pageEntry = entry(page);
	const u32 word0 = m_memory.readRamRecordWord(pageEntry);
	if ((word0 & 0xffffu) != kindAndClass) return 0u;
	const u32 pageOffset = page << PAGE_SHIFT;
	const u32 freeHead = m_memory.readRamRecordWord(pageEntry + 4u);
	const u32 word2 = m_memory.readRamRecordWord(pageEntry + 8u);
	u32 bump = (word2 & HEAP_PAGE_LINK_MASK) << HEAP_BUMP_SHIFT;
	u32 slot;
	u32 nextFree;
	if (freeHead != 0u) {
		slot = freeHead - RAM_BASE;
		const u32 within = slot - pageOffset;
		if (slot < pageOffset || within >= bump || within % size != 0u) return 0u;
		nextFree = m_memory.readRamRecordWord(slot + 4u);
	} else {
		if (bump + size > HEAP_PAGE_SIZE) return 0u;
		slot = pageOffset + bump;
		bump += size;
		nextFree = 0u;
	}
	const bool full = nextFree == 0u && bump + size > HEAP_PAGE_SIZE;
	m_memory.writeRamRecordWord(pageEntry, kindAndClass | (((word0 >> 16) + 1u) << 16));
	m_memory.writeRamRecordWord(pageEntry + 4u, nextFree);
	m_memory.writeRamRecordWord(pageEntry + 8u, (bump >> HEAP_BUMP_SHIFT) | (full ? 0u : word2 & ~HEAP_PAGE_LINK_MASK));
	if (full) unlinkPartial(head, word2);
	return RAM_BASE + slot;
}

void HeapAllocator::free(u32 address) {
	const u32 offset = address - RAM_BASE;
	const u32 page = offset >> PAGE_SHIFT;
	if (page >= m_pageLimit) return;
	const u32 pageEntry = entry(page);
	const u32 word0 = m_memory.readRamRecordWord(pageEntry);
	const u32 kind = word0 & 0xffu;
	if (kind == ObjectRun || kind == OwnedRun) {
		const u32 pages = m_memory.readRamRecordWord(pageEntry + 4u);
		if ((offset & PAGE_MASK) != 0u || pages == 0u || pages > m_pageLimit - page) return;
		releasePages(page, page + pages);
		return;
	}
	const u32 classIndex = (word0 >> 8) & 0xffu;
	const u32 live = word0 >> 16;
	if ((kind != ObjectSlots && kind != OwnedSlots) || classIndex >= CLASS_COUNT || live == 0u) return;
	const u32 size = HEAP_CLASS_BYTES[classIndex];
	const u32 word2 = m_memory.readRamRecordWord(pageEntry + 8u);
	const u32 bump = (word2 & HEAP_PAGE_LINK_MASK) << HEAP_BUMP_SHIFT;
	const u32 within = offset & PAGE_MASK;
	if (within >= bump || within % size != 0u) return;
	const u32 freeHead = m_memory.readRamRecordWord(pageEntry + 4u);
	const bool wasFull = freeHead == 0u && bump + size > HEAP_PAGE_SIZE;
	const u32 head = partialHead(kind == OwnedSlots, classIndex);
	m_memory.writeRamRecordWord(offset, 0u);
	m_memory.writeRamRecordWord(offset + 4u, freeHead);
	if (live == 1u) {
		if (!wasFull) unlinkPartial(head, word2);
		releasePages(page, page + 1u);
		return;
	}
	m_memory.writeRamRecordWord(pageEntry, (word0 & 0xffffu) | ((live - 1u) << 16));
	m_memory.writeRamRecordWord(pageEntry + 4u, address);
	if (wasFull) {
		const u32 next = m_memory.readRamRecordWord(head) & HEAP_PAGE_LINK_MASK;
		m_memory.writeRamRecordWord(pageEntry + 8u, (bump >> HEAP_BUMP_SHIFT) | (next << NEXT_SHIFT));
		if (next != 0u) setPreviousPartial(next, page + 1u);
		m_memory.writeRamRecordWord(head, page + 1u);
	}
}

void HeapAllocator::trimOwnedRun(u32 address, u32 retainedBytes) {
	const u32 page = (address - RAM_BASE) >> PAGE_SHIFT;
	const u32 retained = retainedBytes >> PAGE_SHIFT;
	const u32 length = entry(page) + sizeof(u32);
	const u32 previous = m_memory.readRamRecordWord(length);
	m_memory.writeRamRecordWord(length, retained);
	setAvailable(page + retained, page + previous, true);
}

u32 HeapAllocator::allocateRun(u32 byteCount, bool owned) {
	const u32 pages = byteCount / HEAP_PAGE_SIZE + ((byteCount & PAGE_MASK) != 0u ? 1u : 0u);
	if (pages > m_pageLimit) return 0u;
	const i32 taken = takeTopRun(pages);
	if (taken < 0) return 0u;
	const u32 first = static_cast<u32>(taken);
	const u32 head = entry(first);
	m_memory.writeRamRecordWord(head, owned ? OwnedRun : ObjectRun);
	m_memory.writeRamRecordWord(head + 4u, pages);
	m_memory.writeRamRecordWord(head + 8u, 0u);
	return RAM_BASE + (first << PAGE_SHIFT);
}

i32 HeapAllocator::takeTopPage() {
	const u32 lastWord = (m_pageLimit - 1u) >> 5;
	for (i32 word = static_cast<i32>((m_pageLimit + 31u) >> 5) - 1; word >= 0; --word) {
		const u32 offset = m_management + AVAILABLE_PAGES + static_cast<u32>(word) * 4u;
		const u32 stored = m_memory.readRamRecordWord(offset);
		const u32 bits = static_cast<u32>(word) == lastWord ? stored & m_lastAvailableMask : stored;
		if (bits != 0u) {
			const u32 bit = 31u - static_cast<u32>(std::countl_zero(bits));
			m_memory.writeRamRecordWord(offset, stored & ~(1u << bit));
			m_memory.writeRamRecordPair(m_management + AVAILABLE_PAGE_COUNT,
				availableWholePages() - 1u, claimedWholePages() + 1u);
			return static_cast<i32>((static_cast<u32>(word) << 5) + bit);
		}
	}
	return -1;
}

i32 HeapAllocator::takeTopRun(u32 pages) {
	u32 count = 0u;
	for (i32 page = static_cast<i32>(m_pageLimit) - 1; page >= 0; --page) {
		if (!isAvailable(static_cast<u32>(page))) {
			count = 0u;
			continue;
		}
		if (++count == pages) {
			setAvailable(static_cast<u32>(page), static_cast<u32>(page) + pages, false);
			m_memory.writeRamRecordWord(m_management + CLAIMED_PAGE_COUNT, claimedWholePages() + pages);
			return page;
		}
	}
	return -1;
}

void HeapAllocator::unlinkPartial(u32 head, u32 links) {
	const u32 previous = (links >> PREVIOUS_SHIFT) & HEAP_PAGE_LINK_MASK;
	const u32 next = (links >> NEXT_SHIFT) & HEAP_PAGE_LINK_MASK;
	if (previous == 0u) {
		m_memory.writeRamRecordWord(head, next);
	} else {
		const u32 field = entry(previous - 1u) + 8u;
		m_memory.writeRamRecordWord(field, (m_memory.readRamRecordWord(field) & ~(HEAP_PAGE_LINK_MASK << NEXT_SHIFT)) | (next << NEXT_SHIFT));
	}
	if (next != 0u) setPreviousPartial(next, previous);
}

void HeapAllocator::setPreviousPartial(u32 pageLink, u32 previous) {
	const u32 field = entry(pageLink - 1u) + 8u;
	m_memory.writeRamRecordWord(field, (m_memory.readRamRecordWord(field) & ~(HEAP_PAGE_LINK_MASK << PREVIOUS_SHIFT)) | (previous << PREVIOUS_SHIFT));
}

void HeapAllocator::releasePages(u32 first, u32 end) {
	const u32 offset = entry(first);
	m_memory.writeRamRecordWord(offset, 0u);
	m_memory.writeRamRecordWord(offset + 4u, 0u);
	m_memory.writeRamRecordWord(offset + 8u, 0u);
	setAvailable(first, end, true);
}

void HeapAllocator::setAvailable(u32 first, u32 end, bool available) {
	const u32 pages = end - first, previous = availableWholePages();
	m_memory.writeRamRecordWord(m_management + AVAILABLE_PAGE_COUNT, available ? previous + pages : previous - pages);
	while (first < end) {
		const u32 word = first >> 5;
		const u32 wordEnd = (word + 1u) << 5;
		const u32 mask = (~0u << (first & 31u)) & (~0u >> (wordEnd - std::min(end, wordEnd)));
		const u32 offset = m_management + AVAILABLE_PAGES + word * 4u;
		if (mask == ~0u) m_memory.writeRamRecordWord(offset, available ? ~0u : 0u);
		else {
			const u32 stored = m_memory.readRamRecordWord(offset);
			m_memory.writeRamRecordWord(offset, available ? stored | mask : stored & ~mask);
		}
		first = wordEnd;
	}
}

bool HeapAllocator::isAvailable(u32 page) const {
	return ((m_memory.readRamRecordWord(m_management + AVAILABLE_PAGES + (page >> 5) * 4u) >> (page & 31u)) & 1u) != 0u;
}

u32 HeapAllocator::floorPage() const {
	return (m_memory.ramBusEnd() - RAM_BASE) >> PAGE_SHIFT;
}

u32 HeapAllocator::pageForFloor(u32 address) const {
	const u32 offset = address > RAM_BASE ? address - RAM_BASE : 0u;
	const u32 page = offset / HEAP_PAGE_SIZE + ((offset & PAGE_MASK) != 0u ? 1u : 0u);
	return std::min(std::max(page, m_minimumFloorPage), m_pageLimit);
}

u32 HeapAllocator::partialHead(bool owned, u32 classIndex) const {
	return m_management + PARTIAL_HEADS + ((owned ? CLASS_COUNT : 0u) + classIndex) * 4u;
}

u32 HeapAllocator::entry(u32 page) const {
	return m_management + HEAP_PAGE_ENTRIES + page * HEAP_PAGE_ENTRY_BYTES;
}

} // namespace bmsx
