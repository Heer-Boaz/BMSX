#include "machine/cpu/global_bank.h"

namespace bmsx {

namespace {
using Bank = GlobalBankField;
}

// Refresh the view of the RAM descriptor without moving its contents.
void GlobalBank::bind() {
	const u32 capacity = m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(Bank::Capacity));
	if (capacity == 0u) {
		m_values = {};
		return;
	}
	const u32 base = m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(Bank::Base));
	const u32 payloads = base + 12u * capacity;
	if (m_values.size() == capacity && m_values.wordAddress() == (payloads & RAM_RECORD_WORD_MASK)) return;
	m_values = ValueSpan(m_memory, payloads, payloads + 4u * capacity, capacity);
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

} // namespace bmsx
