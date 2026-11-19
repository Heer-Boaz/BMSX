#include "machine/cpu/global_bank.h"

#include <cstring>

#include "machine/cpu/heap_allocator.h"
#include "machine/cpu/lua_heap.h"

namespace bmsx {

void GlobalBank::bind(GlobalBankState state) {
	m_state = state;
	if (state.capacity == 0u) {
		m_values = {};
		return;
	}
	const u32 payloads = state.base + 12u * state.capacity;
	m_values = ValueSpan(m_memory, payloads, payloads + 4u * state.capacity, state.capacity);
}

void GlobalBank::clear() {
	if (m_state.base != 0u) m_allocator.free(m_state.base);
	bind({});
}

u32 GlobalBank::readBucket(u32 bucket) const {
	return m_memory.readRamRecordWord(m_state.base + 4u * (m_state.capacity + bucket));
}

void GlobalBank::writeBucket(u32 bucket, u32 slot) {
	m_memory.writeRamRecordWord(m_state.base + 4u * (m_state.capacity + bucket), slot + 1u);
}

u32 GlobalBank::bucketFor(StringId key) const {
	const u32 buckets = 2u * m_state.capacity;
	const u32 mask = buckets - 1u;
	const u32 start = scalarValueHash(valueInteger(static_cast<i32>(key))) & mask;
	u32 bucket = start;
	do {
		const u32 slot = readBucket(bucket);
		if (slot == 0u || name((slot - 1u) & (m_state.capacity - 1u)) == key) return bucket;
		bucket = (bucket + 1u) & mask;
	} while (bucket != start);
	// The address counter makes one complete pass through overwritten buckets.
	return start;
}

std::optional<u32> GlobalBank::find(StringId key) const {
	if (m_state.capacity == 0u) return std::nullopt;
	const u32 stored = readBucket(bucketFor(key));
	const u32 slot = (stored - 1u) & (m_state.capacity - 1u);
	return stored != 0u && name(slot) == key ? std::optional<u32>(slot) : std::nullopt;
}

void GlobalBank::grow(StringId key, Value pending) {
	const u32 capacity = m_state.capacity == 0u ? 8u : 2u * m_state.capacity;
	const u32 base = m_heap.allocateRecord(17u * capacity, true, 0, 0, valueString(key), pending);
	const auto old = m_state;
	const ConstValueSpan prior = m_values;
	const u32 offset = base & RAM_RECORD_WORD_MASK;
	std::memset(m_memory.ramData() + offset, 0, 12u * capacity);
	if (old.count != 0u) {
		std::memcpy(m_memory.ramData() + offset, m_memory.ramData() + (old.base & RAM_RECORD_WORD_MASK), 4u * old.count);
	}
	m_memory.invalidateRamWrite(offset, 12u * capacity);
	bind({base, capacity, old.count});
	m_values.copyFrom(prior, 0, 0, old.count);
	m_values.clear(old.count, capacity - old.count);
	for (u32 slot = 0; slot < old.count; ++slot) writeBucket(bucketFor(name(slot)), slot);
	if (old.base != 0u) m_allocator.free(old.base);
}

u32 GlobalBank::registerName(StringId key, Value pending) {
	if (const auto slot = find(key)) return *slot;
	if (m_state.count == m_state.capacity) grow(key, pending);
	const u32 slot = m_state.count;
	const u32 bucket = bucketFor(key);
	m_memory.writeRamRecordWord(m_state.base + 4u * slot, key);
	m_values.set(slot, valueNil());
	writeBucket(bucket, slot);
	++m_state.count;
	return slot;
}

} // namespace bmsx
