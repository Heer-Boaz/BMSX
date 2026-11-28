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
	const u32 payloads = m_memory.readRamRecordWord(m_descriptor + static_cast<u32>(Bank::Values));
	if (m_values.size() == capacity && m_values.wordAddress() == (payloads & RAM_RECORD_WORD_MASK)) return;
	m_values = ValueSpan(m_memory, payloads, payloads + 4u * capacity, capacity);
}

} // namespace bmsx
