#include "object_memory.h"
#include "memory.h"

#include <algorithm>
#include <stdexcept>
#include <unordered_set>

namespace bmsx {

namespace {

inline uint32_t alignObjectSize(uint32_t sizeBytes) {
	return (sizeBytes + 3u) & ~3u;
}

}

uint32_t ObjectHeap::allocate(uint32_t sizeBytes) {
	const uint32_t addr = m_cursor;
	const uint32_t next = addr + sizeBytes;
	if (next > GC_HEAP_BASE + GC_HEAP_SIZE) {
		throw std::runtime_error("[ObjectHeap] Out of heap memory.");
	}
	m_cursor = next;
	return addr;
}

void ObjectHeap::reset() {
	m_cursor = GC_HEAP_BASE;
}

uint32_t ObjectHeap::usedBytes() const {
	return m_cursor - GC_HEAP_BASE;
}

void ObjectHeap::restore(uint32_t usedBytes) {
	m_cursor = GC_HEAP_BASE + usedBytes;
}

ObjectHandleTable::ObjectHandleTable(Memory& memory)
	: m_memory(memory)
	, m_heap() {
	resetHeap();
}

void ObjectHandleTable::reserveHandles(uint32_t minHandle) {
	if (minHandle > OBJECT_HANDLE_COUNT) {
		throw std::runtime_error("[ObjectHandleTable] Reserve exceeds handle capacity.");
	}
	if (minHandle > allocFloor()) {
		setAllocFloor(minHandle);
	}
	if (minHandle > nextHandle()) {
		setNextHandle(minHandle);
	}
	rebuildFreeList(nextHandle());
}

ObjectAllocation ObjectHandleTable::allocateObject(uint32_t type, uint32_t sizeBytes, uint32_t flags) {
	sizeBytes = alignObjectSize(sizeBytes);
	uint32_t id = freeListHead();
	if (id != 0) {
		const ObjectHandleEntry freeEntry = readEntry(id);
		setFreeListHead(freeEntry.reserved);
	} else {
		id = nextHandle();
		if (id >= OBJECT_HANDLE_COUNT) {
			throw std::runtime_error("[ObjectHandleTable] Out of object handles.");
		}
		setNextHandle(id + 1);
	}
	const uint32_t addr = m_heap.allocate(sizeBytes);
	writeHeapHeader(addr, type, flags, sizeBytes);
	writeEntry(id, addr, sizeBytes, type, flags, 0);
	return { id, addr, sizeBytes, type, flags };
}

void ObjectHandleTable::writeEntry(uint32_t id, uint32_t addr, uint32_t sizeBytes, uint32_t type, uint32_t flags, uint32_t reserved) {
	const uint32_t entryAddr = OBJECT_HANDLE_TABLE_BASE + id * OBJECT_HANDLE_ENTRY_SIZE;
	m_memory.writeU32(entryAddr, addr);
	m_memory.writeU32(entryAddr + 4, sizeBytes);
	m_memory.writeU32(entryAddr + 8, type);
	m_memory.writeU32(entryAddr + 12, flags);
	m_memory.writeU32(entryAddr + 16, reserved);
}

void ObjectHandleTable::writeU32(uint32_t addr, uint32_t value) {
	m_memory.writeU32(addr, value);
}

uint32_t ObjectHandleTable::readU32(uint32_t addr) const {
	return m_memory.readU32(addr);
}

void ObjectHandleTable::writeBytes(uint32_t addr, const uint8_t* data, size_t length) {
	m_memory.writeBytes(addr, data, length);
}

void ObjectHandleTable::readBytes(uint32_t addr, uint8_t* data, size_t length) const {
	m_memory.readBytes(addr, data, length);
}

ObjectHandleEntry ObjectHandleTable::readEntry(uint32_t id) const {
	const uint32_t entryAddr = OBJECT_HANDLE_TABLE_BASE + id * OBJECT_HANDLE_ENTRY_SIZE;
	return {
		m_memory.readU32(entryAddr),
		m_memory.readU32(entryAddr + 4),
		m_memory.readU32(entryAddr + 8),
		m_memory.readU32(entryAddr + 12),
		m_memory.readU32(entryAddr + 16),
	};
}

void ObjectHandleTable::rebuildFreeHandles(const std::vector<uint32_t>& liveHandleIds) {
	const uint32_t handleLimit = nextHandle();
	std::unordered_set<uint32_t> liveSet;
	liveSet.reserve(liveHandleIds.size());
	for (uint32_t id : liveHandleIds) {
		if (id != 0) {
			liveSet.insert(id);
		}
	}
	rebuildFreeList(handleLimit, &liveSet);
}

void ObjectHandleTable::compact(const std::vector<uint32_t>& liveHandleIds) {
	const uint32_t handleLimit = nextHandle();
	std::unordered_set<uint32_t> liveSet;
	liveSet.reserve(liveHandleIds.size());
	for (uint32_t id : liveHandleIds) {
		if (id != 0) {
			liveSet.insert(id);
		}
	}
	struct LiveHandleEntry {
		uint32_t id = 0;
		ObjectHandleEntry entry;
	};
	std::vector<LiveHandleEntry> liveEntries;
	liveEntries.reserve(liveSet.size());
	for (uint32_t id : liveSet) {
		liveEntries.push_back({ id, readEntry(id) });
	}
	std::sort(liveEntries.begin(), liveEntries.end(), [](const LiveHandleEntry& lhs, const LiveHandleEntry& rhs) {
		return lhs.entry.addr < rhs.entry.addr;
	});

	size_t totalLiveBytes = 0;
	for (const LiveHandleEntry& live : liveEntries) {
		totalLiveBytes += live.entry.sizeBytes;
	}

	std::vector<uint8_t> compactedBytes(totalLiveBytes);
	size_t offset = 0;
	uint32_t addr = GC_HEAP_BASE;
	for (const LiveHandleEntry& live : liveEntries) {
		readBytes(live.entry.addr, compactedBytes.data() + offset, live.entry.sizeBytes);
		writeEntry(live.id, addr, live.entry.sizeBytes, live.entry.type, live.entry.flags, live.entry.reserved);
		offset += live.entry.sizeBytes;
		addr += live.entry.sizeBytes;
	}

	if (!compactedBytes.empty()) {
		writeBytes(GC_HEAP_BASE, compactedBytes.data(), compactedBytes.size());
	}

	rebuildFreeList(handleLimit, &liveSet);
	m_heap.restore(static_cast<uint32_t>(totalLiveBytes));
}

void ObjectHandleTable::resetHeap() {
	m_heap.reset();
	writeEntry(0, 1, 0, 1, 0, 0);
}

uint32_t ObjectHandleTable::usedHeapBytes() const {
	return m_heap.usedBytes();
}

ObjectHandleTableState ObjectHandleTable::captureState() const {
	ObjectHandleTableState state;
	state.heapUsedBytes = m_heap.usedBytes();
	state.handleTableBytes.resize(static_cast<size_t>(nextHandle()) * OBJECT_HANDLE_ENTRY_SIZE);
	state.heapBytes.resize(state.heapUsedBytes);
	m_memory.readBytes(OBJECT_HANDLE_TABLE_BASE, state.handleTableBytes.data(), state.handleTableBytes.size());
	m_memory.readBytes(GC_HEAP_BASE, state.heapBytes.data(), state.heapBytes.size());
	return state;
}

void ObjectHandleTable::restoreState(const ObjectHandleTableState& state) {
	m_memory.writeBytes(OBJECT_HANDLE_TABLE_BASE, state.handleTableBytes.data(), state.handleTableBytes.size());
	m_memory.writeBytes(GC_HEAP_BASE, state.heapBytes.data(), state.heapBytes.size());
	m_heap.restore(state.heapUsedBytes);
}

uint32_t ObjectHandleTable::nextHandle() const {
	return m_memory.readU32(OBJECT_HANDLE_TABLE_BASE + HANDLE_TABLE_HEADER_NEXT_HANDLE_OFFSET);
}

void ObjectHandleTable::setNextHandle(uint32_t value) {
	m_memory.writeU32(OBJECT_HANDLE_TABLE_BASE + HANDLE_TABLE_HEADER_NEXT_HANDLE_OFFSET, value);
}

uint32_t ObjectHandleTable::freeListHead() const {
	return m_memory.readU32(OBJECT_HANDLE_TABLE_BASE + HANDLE_TABLE_HEADER_FREE_LIST_HEAD_OFFSET);
}

void ObjectHandleTable::setFreeListHead(uint32_t value) {
	m_memory.writeU32(OBJECT_HANDLE_TABLE_BASE + HANDLE_TABLE_HEADER_FREE_LIST_HEAD_OFFSET, value);
}

uint32_t ObjectHandleTable::allocFloor() const {
	return m_memory.readU32(OBJECT_HANDLE_TABLE_BASE + HANDLE_TABLE_HEADER_ALLOC_FLOOR_OFFSET);
}

void ObjectHandleTable::setAllocFloor(uint32_t value) {
	m_memory.writeU32(OBJECT_HANDLE_TABLE_BASE + HANDLE_TABLE_HEADER_ALLOC_FLOOR_OFFSET, value);
}

void ObjectHandleTable::rebuildFreeList(uint32_t nextHandleValue, const std::unordered_set<uint32_t>* liveSet) {
	uint32_t freeHead = 0;
	const uint32_t floor = allocFloor();
	for (uint32_t id = nextHandleValue; id > 1; --id) {
		const uint32_t handleId = id - 1;
		if (liveSet && liveSet->find(handleId) != liveSet->end()) {
			continue;
		}
		const ObjectHandleEntry entry = readEntry(handleId);
		if (handleId >= floor && (entry.type != 0 || entry.flags == OBJECT_HANDLE_ENTRY_FLAG_FREE)) {
			writeEntry(handleId, 0, 0, 0, OBJECT_HANDLE_ENTRY_FLAG_FREE, freeHead);
			freeHead = handleId;
			continue;
		}
		if (entry.type == 0 && entry.flags == 0 && entry.reserved == 0) {
			continue;
		}
		writeEntry(handleId, 0, 0, 0, 0, 0);
	}
	setFreeListHead(freeHead);
}

void ObjectHandleTable::writeHeapHeader(uint32_t addr, uint32_t type, uint32_t flags, uint32_t sizeBytes) {
	m_memory.writeU32(addr, type);
	m_memory.writeU32(addr + 4, flags);
	m_memory.writeU32(addr + 8, sizeBytes);
}

} // namespace bmsx
