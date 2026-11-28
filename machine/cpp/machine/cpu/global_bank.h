#pragma once

#include <optional>

#include "machine/cpu/string_pool.h"
#include "machine/cpu/value_slots.h"
#include "spec/blua32/execution_domain.h"

namespace bmsx {

class GcHeap;

// Main RAM owns the Value payload address, capacity and live slot count.
class GlobalBank {
public:
	GlobalBank(Memory& memory, u32 descriptor) : m_memory(memory), m_descriptor(descriptor) {}
	bool tryWriteSlot(u32 slot, Value value) {
		if (valueTagHasGcEdge(valueTag(value))) return false;
		m_values.set(slot, value);
		return true;
	}
	u32 capacity() const { return static_cast<u32>(m_values.size()); }
	u32 count() const { return m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(GlobalBankField::Count)); }
	ConstValueSpan values() const { return m_values; }
	const ValueSpan& values() { return m_values; }
	void bind();
	void detach() { m_values = {}; }

	// Definitions live in the native fixture reference target.
	StringId name(u32 slot) const;
	std::optional<u32> find(StringId key) const;
	void writeSlot(GcHeap&, u32 slot, Value value);
	u32 registerName(GcHeap&, StringId key, Value pending = valueNil());
	void clear(GcHeap&);

private:
	u32 bucketFor(u32 base, u32 capacity, StringId key) const;
	std::optional<u32> findSlot(u32 base, u32 capacity, StringId key) const;
	void grow(u32 oldBase, u32 base, u32 capacity, u32 count);

	Memory& m_memory;
	u32 m_descriptor;
	ValueSpan m_values;
};

} // namespace bmsx
