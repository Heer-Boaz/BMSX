#pragma once

#include <optional>

#include "machine/cpu/gc_heap.h"
#include "spec/blua32/execution_domain.h"

namespace bmsx {

// The triples are owned by RAM. Ordinals are stable even when the backing moves:
// name words, two hash buckets per slot, payloads, then tags.
class GlobalBank {
public:
	GlobalBank(Memory& memory, GcHeap& heap, u32 descriptor) : m_memory(memory), m_heap(heap), m_descriptor(descriptor) {}

	void writeSlot(u32 slot, Value value) {
		m_values.set(slot, value);
		if (valueTagHasGcEdge(valueTag(value))) m_heap.markGlobalWrite(value);
	}
	bool tryWriteSlot(u32 slot, Value value) {
		if (valueTagHasGcEdge(valueTag(value))) return false;
		m_values.set(slot, value);
		return true;
	}
	u32 capacity() const { return static_cast<u32>(m_values.size()); }
	u32 count() const { return m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(GlobalBankField::Count)); }
	StringId name(u32 slot) const {
		const u32 base = m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(GlobalBankField::Base));
		return m_memory.readRamRecordWord(base + 4u * slot);
	}
	ConstValueSpan values() const { return m_values; }
	const ValueSpan& values() { return m_values; }
	std::optional<u32> find(StringId key) const;
	u32 registerName(StringId key, Value pending = valueNil());
	void bind();
	void detach() { m_values = {}; }
	void clear();

private:
	u32 bucketFor(u32 base, u32 capacity, StringId key) const;
	std::optional<u32> findSlot(u32 base, u32 capacity, StringId key) const;
	void grow(u32 oldBase, u32 base, u32 capacity, u32 count);

	Memory& m_memory;
	GcHeap& m_heap;
	u32 m_descriptor;
	ValueSpan m_values;
};

} // namespace bmsx
