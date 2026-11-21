#pragma once

#include <optional>

#include "machine/cpu/value_slots.h"

namespace bmsx {

class LuaHeap;

struct GlobalBankState {
	u32 base = 0;
	u32 capacity = 0;
	u32 count = 0;
	bool operator==(const GlobalBankState&) const = default;
};

// A CPU-owned namespace. Ordinals are stable even when the bank moves.
// Guest bytes are name words, two hash buckets per slot, payloads, then tags.
class GlobalBank {
public:
	GlobalBank(Memory& memory, LuaHeap& heap) : m_memory(memory), m_heap(heap) {}

	Value readSlot(u32 slot) const {
		const u32 word = m_memory.readRamRecordWord(m_state.base + 12u * m_state.capacity + 4u * slot);
		const auto tag = static_cast<ValueTag>(m_memory.readRamRecordByte(m_state.base + 16u * m_state.capacity + slot));
		return valueFromTag(tag, word);
	}
	void writeSlot(u32 slot, Value value) {
		m_memory.writeRamRecordWord(m_state.base + 12u * m_state.capacity + 4u * slot, valuePayload(value));
		m_memory.writeRamRecordByte(m_state.base + 16u * m_state.capacity + slot, static_cast<u8>(valueTag(value)));
	}
	u32 capacity() const { return m_state.capacity; }
	u32 count() const { return m_state.count; }
	StringId name(u32 slot) const { return m_memory.readRamRecordWord(m_state.base + 4u * slot); }
	ConstValueSpan values() const { return m_values; }
	ValueSpan values() { return m_values; }
	std::optional<u32> find(StringId key) const;
	u32 registerName(StringId key, Value pending = valueNil());
	GlobalBankState captureState() const { return m_state; }
	void bind(GlobalBankState state);
	void clear();

private:
	u32 bucketFor(StringId key) const;
	u32 readBucket(u32 bucket) const;
	void writeBucket(u32 bucket, u32 slot);
	void grow(StringId key, Value pending);

	Memory& m_memory;
	LuaHeap& m_heap;
	GlobalBankState m_state;
	ValueSpan m_values;
};

} // namespace bmsx
