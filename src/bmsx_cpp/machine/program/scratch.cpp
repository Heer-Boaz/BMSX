#include "machine/program/scratch.h"

namespace bmsx {

LuaScratchState::ValueLease::ValueLease(LuaScratchState& owner, std::vector<Value>& values) noexcept
	: m_owner(&owner)
	, m_values(&values) {
}

LuaScratchState::ValueLease::ValueLease(ValueLease&& other) noexcept
	: m_owner(other.m_owner)
	, m_values(other.m_values) {
	other.m_owner = nullptr;
	other.m_values = nullptr;
}

LuaScratchState::ValueLease::~ValueLease() {
	if (m_owner) {
		m_owner->releaseValue(*m_values);
	}
}

LuaScratchState::ValueLease LuaScratchState::acquireValue() {
	std::vector<Value>& values = m_valueScratch.get(m_valueScratchIndex);
	m_valueScratchIndex += 1;
	values.clear();
	return ValueLease(*this, values);
}

void LuaScratchState::releaseValue(std::vector<Value>& values) {
	values.clear();
	m_valueScratchIndex -= 1;
}

} // namespace bmsx
