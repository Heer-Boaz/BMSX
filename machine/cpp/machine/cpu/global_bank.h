#pragma once

#include "machine/cpu/value_slots.h"
#include "spec/blua32/execution_domain.h"

namespace bmsx {

namespace test { class NativeGlobalBankReference; }

// Main RAM owns the Value payload address, capacity and live slot count.
class GlobalBank {
public:
	GlobalBank(Memory& memory, u32 descriptor) : m_memory(memory), m_descriptor(descriptor) {}
	bool tryWriteSlot(u32 slot, Value value) {
		if (valueTagIsStorageReference(valueTag(value))) return false;
		m_values.set(slot, value);
		return true;
	}
	u32 capacity() const { return static_cast<u32>(m_values.size()); }
	u32 count() const { return m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(GlobalBankField::Count)); }
	ConstValueSpan values() const { return m_values; }
	const ValueSpan& values() { return m_values; }
	void bind();
	void detach() { m_values = {}; }

private:
	friend class test::NativeGlobalBankReference;
	Memory& m_memory;
	u32 m_descriptor;
	ValueSpan m_values;
};

} // namespace bmsx
