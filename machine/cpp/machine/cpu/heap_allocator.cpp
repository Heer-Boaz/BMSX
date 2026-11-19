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
constexpr u32 MAX_PAGES = 1024u;

// Management-area layout, as byte offsets from its base. Every field is a
// little-endian word in guest RAM; partial-list links store page + 1.
constexpr u32 FLOOR = 0x000u;
constexpr u32 OCCUPIED = 0x004u;
constexpr u32 PARTIAL_HEADS = 0x040u;
constexpr u32 AVAILABLE_PAGES = 0x200u;
constexpr u32 PAGE_ENTRIES = 0x1000u;
constexpr u32 PAGE_ENTRY_BYTES = 12u;

// Page entry: word 0 = kind | class << 8 | live << 16; word 1 = free-slot head
// (guest address), run length or run head; word 2 = bump | next partial << 16.
enum PageKind : u32 {
	Unused = 0,
	ObjectSlots = 1,
	OwnedSlots = 2,
	ObjectRun = 3,
	OwnedRun = 4,
	RunTail = 5,
};

} // namespace

u32 heapClassIndex(u32 byteCount) {
	if (byteCount <= 64u) return ((byteCount + 7u) >> 3) - 1u;
	// byteCount lies in (2^(ceilingShift - 1), 2^ceilingShift]; that span has four classes.
	const u32 ceilingShift = 32u - static_cast<u32>(std::countl_zero(byteCount - 1u));
	const u32 stepShift = ceilingShift - 3u;
	const u32 quarter = (byteCount - (1u << (ceilingShift - 1u)) + (1u << stepShift) - 1u) >> stepShift;
	return 8u + (ceilingShift - 7u) * 4u + quarter - 1u;
}

u32 heapAllocationBytes(u32 byteCount) {
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
	m_memory.writeRamRecordWord(m_management + FLOOR, RAM_BASE + (page << PAGE_SHIFT));
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
	m_memory.writeRamRecordWord(m_management + FLOOR, RAM_BASE + (next << PAGE_SHIFT));
	return true;
}

u32 HeapAllocator::floorAddress() const {
	return RAM_BASE + (floorPage() << PAGE_SHIFT);
}

u32 HeapAllocator::capacityBytes() const {
	return (m_pageLimit - floorPage()) << PAGE_SHIFT;
}

u32 HeapAllocator::occupiedBytes() const {
	return m_memory.readRamRecordWord(m_management + OCCUPIED);
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
	u32 bump = word2 & 0xffffu;
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
	const u32 nextPartial = word2 >> 16;
	m_memory.writeRamRecordWord(pageEntry, kindAndClass | (((word0 >> 16) + 1u) << 16));
	m_memory.writeRamRecordWord(pageEntry + 4u, nextFree);
	m_memory.writeRamRecordWord(pageEntry + 8u, bump | ((full ? 0u : nextPartial) << 16));
	if (full) m_memory.writeRamRecordWord(head, nextPartial);
	m_memory.writeRamRecordWord(m_management + OCCUPIED, occupiedBytes() + size);
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
		m_memory.writeRamRecordWord(m_management + OCCUPIED, occupiedBytes() - (pages << PAGE_SHIFT));
		return;
	}
	const u32 classIndex = (word0 >> 8) & 0xffu;
	const u32 live = word0 >> 16;
	if ((kind != ObjectSlots && kind != OwnedSlots) || classIndex >= CLASS_COUNT || live == 0u) return;
	const u32 size = HEAP_CLASS_BYTES[classIndex];
	const u32 word2 = m_memory.readRamRecordWord(pageEntry + 8u);
	const u32 bump = word2 & 0xffffu;
	const u32 within = offset & PAGE_MASK;
	if (within >= bump || within % size != 0u) return;
	const u32 freeHead = m_memory.readRamRecordWord(pageEntry + 4u);
	const bool wasFull = freeHead == 0u && bump + size > HEAP_PAGE_SIZE;
	const u32 head = partialHead(kind == OwnedSlots, classIndex);
	m_memory.writeRamRecordWord(offset, 0u);
	m_memory.writeRamRecordWord(offset + 4u, freeHead);
	m_memory.writeRamRecordWord(m_management + OCCUPIED, occupiedBytes() - size);
	if (live == 1u) {
		if (!wasFull) unlinkPartial(head, page);
		releasePages(page, page + 1u);
		return;
	}
	m_memory.writeRamRecordWord(pageEntry, (word0 & 0xffffu) | ((live - 1u) << 16));
	m_memory.writeRamRecordWord(pageEntry + 4u, address);
	if (wasFull) {
		m_memory.writeRamRecordWord(pageEntry + 8u, bump | (m_memory.readRamRecordWord(head) << 16));
		m_memory.writeRamRecordWord(head, page + 1u);
	}
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
	for (u32 page = first + 1u; page < first + pages; ++page) {
		const u32 tail = entry(page);
		m_memory.writeRamRecordWord(tail, RunTail);
		m_memory.writeRamRecordWord(tail + 4u, first);
		m_memory.writeRamRecordWord(tail + 8u, 0u);
	}
	m_memory.writeRamRecordWord(m_management + OCCUPIED, occupiedBytes() + (pages << PAGE_SHIFT));
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
			return page;
		}
	}
	return -1;
}

void HeapAllocator::unlinkPartial(u32 head, u32 page) {
	u32 previous = 0u;
	u32 current = m_memory.readRamRecordWord(head);
	for (u32 steps = 0u; current != 0u && steps < m_pageLimit; ++steps) {
		const u32 currentPage = current - 1u;
		if (currentPage >= m_pageLimit) return;
		const u32 next = m_memory.readRamRecordWord(entry(currentPage) + 8u) >> 16;
		if (currentPage == page) {
			if (previous == 0u) {
				m_memory.writeRamRecordWord(head, next);
			} else {
				const u32 previousLink = entry(previous - 1u) + 8u;
				m_memory.writeRamRecordWord(previousLink, (m_memory.readRamRecordWord(previousLink) & 0xffffu) | (next << 16));
			}
			return;
		}
		previous = current;
		current = next;
	}
}

void HeapAllocator::releasePages(u32 first, u32 end) {
	for (u32 page = first; page < end; ++page) {
		const u32 released = entry(page);
		m_memory.writeRamRecordWord(released, 0u);
		m_memory.writeRamRecordWord(released + 4u, 0u);
		m_memory.writeRamRecordWord(released + 8u, 0u);
	}
	setAvailable(first, end, true);
}

void HeapAllocator::setAvailable(u32 first, u32 end, bool available) {
	for (u32 page = first; page < end; ++page) {
		const u32 offset = m_management + AVAILABLE_PAGES + (page >> 5) * 4u;
		const u32 bit = 1u << (page & 31u);
		const u32 stored = m_memory.readRamRecordWord(offset);
		m_memory.writeRamRecordWord(offset, available ? stored | bit : stored & ~bit);
	}
}

bool HeapAllocator::isAvailable(u32 page) const {
	return ((m_memory.readRamRecordWord(m_management + AVAILABLE_PAGES + (page >> 5) * 4u) >> (page & 31u)) & 1u) != 0u;
}

u32 HeapAllocator::floorPage() const {
	const u32 page = (m_memory.readRamRecordWord(m_management + FLOOR) - RAM_BASE) >> PAGE_SHIFT;
	return std::min(std::max(page, m_minimumFloorPage), m_pageLimit);
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
	return m_management + PAGE_ENTRIES + page * PAGE_ENTRY_BYTES;
}

} // namespace bmsx
