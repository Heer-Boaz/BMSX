#include "machine/cpu/global_bank.h"
#include "machine/cpu/gc_heap.h"

#include <cstring>

namespace bmsx {

namespace {
constexpr u32 GLOBAL_NAME_BUDGET_BYTES = 9u;
constexpr u32 NAME_AND_BUCKET_BYTES_PER_SLOT = 12u;
using Bank = GlobalBankField;
}

u32 GlobalBank::bucketFor(u32 base, u32 capacity, StringId key) const {
	const u32 slots = base + 4u * capacity;
	const u32 mask = 2u * capacity - 1u;
	const u32 start = hashCanonicalTableKey(valueInteger(static_cast<i32>(key))) & mask;
	u32 bucket = start;
	do {
		const u32 slot = m_memory.readRamRecordWord(slots + 4u * bucket);
		if (slot == 0u || m_memory.readRamRecordWord(base + 4u * ((slot - 1u) & (capacity - 1u))) == key) return bucket;
		bucket = (bucket + 1u) & mask;
	} while (bucket != start);
	// The address counter makes one complete pass through overwritten buckets.
	return start;
}

std::optional<u32> GlobalBank::findSlot(u32 base, u32 capacity, StringId key) const {
	if (capacity == 0u) return std::nullopt;
	const u32 stored = m_memory.readRamRecordWord(base + 4u * (capacity + bucketFor(base, capacity, key)));
	const u32 slot = (stored - 1u) & (capacity - 1u);
	return stored != 0u && m_memory.readRamRecordWord(base + 4u * slot) == key ? std::optional<u32>(slot) : std::nullopt;
}

std::optional<u32> GlobalBank::find(StringId key) const {
	const u32 payloads = m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(Bank::Values));
	const u32 capacity = m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(Bank::Capacity));
	return findSlot(payloads - NAME_AND_BUCKET_BYTES_PER_SLOT * capacity, capacity, key);
}

StringId GlobalBank::name(u32 slot) const {
	const u32 payloads = m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(Bank::Values));
	const u32 capacity = m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(Bank::Capacity));
	return m_memory.readRamRecordWord(payloads - NAME_AND_BUCKET_BYTES_PER_SLOT * capacity + 4u * slot);
}

void GlobalBank::writeSlot(GcHeap& heap, u32 slot, Value value) {
	m_values.set(slot, value);
	if (valueTagHasGcEdge(valueTag(value))) heap.markGlobalWrite(value);
}

void GlobalBank::clear(GcHeap& heap) {
	if (const u32 payloads = m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(Bank::Values))) {
		const u32 capacity = m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(Bank::Capacity));
		heap.budget.releaseRecord(payloads - NAME_AND_BUCKET_BYTES_PER_SLOT * capacity, GLOBAL_NAME_BUDGET_BYTES * count());
	}
	m_memory.writeRamRecordWord(m_descriptor + static_cast<u32>(Bank::Values), 0u);
	m_memory.writeRamRecordWord(m_descriptor + static_cast<u32>(Bank::Capacity), 0u);
	m_memory.writeRamRecordWord(m_descriptor + static_cast<u32>(Bank::Count), 0u);
	m_values = {};
}

void GlobalBank::grow(u32 oldBase, u32 base, u32 capacity, u32 count) {
	const ConstValueSpan prior = m_values;
	const u32 offset = base & RAM_RECORD_WORD_MASK;
	std::memset(m_memory.ramData() + offset, 0, NAME_AND_BUCKET_BYTES_PER_SLOT * capacity);
	if (count != 0u)
		std::memcpy(m_memory.ramData() + offset, m_memory.ramData() + (oldBase & RAM_RECORD_WORD_MASK), 4u * count);
	m_memory.invalidateRamWrite(offset, NAME_AND_BUCKET_BYTES_PER_SLOT * capacity);
	const u32 payloads = base + NAME_AND_BUCKET_BYTES_PER_SLOT * capacity;
	m_memory.writeRamRecordWord(m_descriptor + static_cast<u32>(Bank::Values), payloads);
	m_memory.writeRamRecordWord(m_descriptor + static_cast<u32>(Bank::Capacity), capacity);
	m_values = ValueSpan(m_memory, payloads, payloads + 4u * capacity, capacity);
	m_values.copyFrom(prior, 0, 0, count);
	m_values.clear(count, capacity - count);
	for (u32 slot = 0; slot < count; ++slot) {
		const auto key = m_memory.readRamRecordWord(base + 4u * slot);
		m_memory.writeRamRecordWord(base + 4u * (capacity + bucketFor(base, capacity, key)), slot + 1u);
	}
}

u32 GlobalBank::registerName(GcHeap& heap, StringId key, Value pending) {
	const u32 payloads = m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(Bank::Values));
	u32 capacity = m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(Bank::Capacity));
	u32 base = payloads - NAME_AND_BUCKET_BYTES_PER_SLOT * capacity;
	if (const auto slot = findSlot(base, capacity, key)) return *slot;
	const u32 slot = count();
	u32 oldBase = 0u;
	if (slot == capacity) {
		capacity = capacity == 0u ? 8u : 2u * capacity;
		const u32 backing = heap.budget.reserveBacking(17u * capacity, GLOBAL_NAME_BUDGET_BYTES, valueString(key), pending);
		oldBase = base;
		grow(oldBase, backing, capacity, slot);
		base = backing;
	} else {
		heap.budget.admit(GLOBAL_NAME_BUDGET_BYTES, valueString(key), pending);
	}
	const u32 bucket = bucketFor(base, capacity, key);
	m_memory.writeRamRecordWord(base + 4u * slot, key);
	m_values.set(slot, valueNil());
	m_memory.writeRamRecordWord(base + 4u * (capacity + bucket), slot + 1u);
	m_memory.writeRamRecordWord(m_descriptor + static_cast<u32>(Bank::Count), slot + 1u);
	heap.markGlobalWrite(valueString(key));
	heap.budget.replaceRecord(oldBase, 0u, GLOBAL_NAME_BUDGET_BYTES);
	return slot;
}

} // namespace bmsx
