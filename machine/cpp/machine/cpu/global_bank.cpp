#include "machine/cpu/global_bank.h"

#include <cstring>

namespace bmsx {

namespace {
constexpr u32 GLOBAL_NAME_BUDGET_BYTES = 9u;
using Bank = GlobalBankField;
}

// RAM has already been restored by the machine; reconstruct only the borrowed view.
void GlobalBank::bind() {
	const u32 capacity = m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(Bank::Capacity));
	if (capacity == 0u) {
		m_values = {};
		return;
	}
	const u32 base = m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(Bank::Base));
	const u32 payloads = base + 12u * capacity;
	m_values = ValueSpan(m_memory, payloads, payloads + 4u * capacity, capacity);
}

void GlobalBank::clear() {
	if (const u32 base = m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(Bank::Base)))
		m_heap.budget.releaseRecord(base, GLOBAL_NAME_BUDGET_BYTES * count());
	m_memory.writeRamRecordWord(m_descriptor + static_cast<u32>(Bank::Base), 0u);
	m_memory.writeRamRecordWord(m_descriptor + static_cast<u32>(Bank::Capacity), 0u);
	m_memory.writeRamRecordWord(m_descriptor + static_cast<u32>(Bank::Count), 0u);
	m_values = {};
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
	const u32 base = m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(Bank::Base));
	const u32 capacity = m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(Bank::Capacity));
	return findSlot(base, capacity, key);
}

void GlobalBank::grow(u32 oldBase, u32 base, u32 capacity, u32 count) {
	const ConstValueSpan prior = m_values;
	const u32 offset = base & RAM_RECORD_WORD_MASK;
	std::memset(m_memory.ramData() + offset, 0, 12u * capacity);
	if (count != 0u)
		std::memcpy(m_memory.ramData() + offset, m_memory.ramData() + (oldBase & RAM_RECORD_WORD_MASK), 4u * count);
	m_memory.invalidateRamWrite(offset, 12u * capacity);
	m_memory.writeRamRecordWord(m_descriptor + static_cast<u32>(Bank::Base), base);
	m_memory.writeRamRecordWord(m_descriptor + static_cast<u32>(Bank::Capacity), capacity);
	const u32 payloads = base + 12u * capacity;
	m_values = ValueSpan(m_memory, payloads, payloads + 4u * capacity, capacity);
	m_values.copyFrom(prior, 0, 0, count);
	m_values.clear(count, capacity - count);
	for (u32 slot = 0; slot < count; ++slot) {
		const auto key = m_memory.readRamRecordWord(base + 4u * slot);
		m_memory.writeRamRecordWord(base + 4u * (capacity + bucketFor(base, capacity, key)), slot + 1u);
	}
}

u32 GlobalBank::registerName(StringId key, Value pending) {
	u32 base = m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(Bank::Base));
	u32 capacity = m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(Bank::Capacity));
	if (const auto slot = findSlot(base, capacity, key)) return *slot;
	const u32 slot = count();
	u32 oldBase = 0u;
	if (slot == capacity) {
		capacity = capacity == 0u ? 8u : 2u * capacity;
		const u32 backing = m_heap.budget.reserveBacking(17u * capacity, GLOBAL_NAME_BUDGET_BYTES, valueString(key), pending);
		oldBase = base;
		grow(oldBase, backing, capacity, slot);
		base = backing;
	} else {
		m_heap.budget.admit(GLOBAL_NAME_BUDGET_BYTES, valueString(key), pending);
	}
	const u32 bucket = bucketFor(base, capacity, key);
	m_memory.writeRamRecordWord(base + 4u * slot, key);
	m_values.set(slot, valueNil());
	m_memory.writeRamRecordWord(base + 4u * (capacity + bucket), slot + 1u);
	m_memory.writeRamRecordWord(m_descriptor + static_cast<u32>(Bank::Count), slot + 1u);
	m_heap.markGlobalWrite(valueString(key));
	m_heap.budget.replaceRecord(oldBase, 0u, GLOBAL_NAME_BUDGET_BYTES);
	return slot;
}

} // namespace bmsx
