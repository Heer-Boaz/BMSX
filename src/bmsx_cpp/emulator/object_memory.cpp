#include "object_memory.h"
#include "memory.h"

#include <stdexcept>

namespace bmsx {

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
}

void ObjectHandleTable::reserveHandles(uint32_t minHandle) {
	if (minHandle > OBJECT_HANDLE_COUNT) {
		throw std::runtime_error("[ObjectHandleTable] Reserve exceeds handle capacity.");
	}
	if (minHandle > m_nextHandle) {
		m_nextHandle = minHandle;
	}
}

ObjectAllocation ObjectHandleTable::allocateObject(uint32_t type, uint32_t sizeBytes, uint32_t flags) {
	if (m_nextHandle >= OBJECT_HANDLE_COUNT) {
		throw std::runtime_error("[ObjectHandleTable] Out of object handles.");
	}
	const uint32_t addr = m_heap.allocate(sizeBytes);
	writeHeapHeader(addr, type, flags, sizeBytes);
	const uint32_t id = m_nextHandle;
	writeEntry(id, addr, sizeBytes, type, flags, 0);
	m_nextHandle += 1;
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

void ObjectHandleTable::resetHeap() {
	m_heap.reset();
	m_nextHandle = 1;
}

ObjectHandleTableState ObjectHandleTable::captureState() const {
	ObjectHandleTableState state;
	state.nextHandle = m_nextHandle;
	state.heapUsedBytes = m_heap.usedBytes();
	state.handleTableBytes.resize(static_cast<size_t>(m_nextHandle) * OBJECT_HANDLE_ENTRY_SIZE);
	state.heapBytes.resize(state.heapUsedBytes);
	m_memory.readBytes(OBJECT_HANDLE_TABLE_BASE, state.handleTableBytes.data(), state.handleTableBytes.size());
	m_memory.readBytes(GC_HEAP_BASE, state.heapBytes.data(), state.heapBytes.size());
	return state;
}

void ObjectHandleTable::restoreState(const ObjectHandleTableState& state) {
	m_memory.writeBytes(OBJECT_HANDLE_TABLE_BASE, state.handleTableBytes.data(), state.handleTableBytes.size());
	m_memory.writeBytes(GC_HEAP_BASE, state.heapBytes.data(), state.heapBytes.size());
	m_nextHandle = state.nextHandle;
	m_heap.restore(state.heapUsedBytes);
}

void ObjectHandleTable::writeHeapHeader(uint32_t addr, uint32_t type, uint32_t flags, uint32_t sizeBytes) {
	m_memory.writeU32(addr, type);
	m_memory.writeU32(addr + 4, flags);
	m_memory.writeU32(addr + 8, sizeBytes);
}

} // namespace bmsx
