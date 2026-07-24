#pragma once

#include "common/scratchbuffer.h"
#include "machine/cpu/cpu.h"

#include <vector>

namespace bmsx {

class LuaScratchState {
public:
	class ValueLease {
	public:
		ValueLease(LuaScratchState& owner, std::vector<Value>& values) noexcept;
		ValueLease(const ValueLease&) = delete;
		ValueLease& operator=(const ValueLease&) = delete;
		ValueLease(ValueLease&& other) noexcept;
		ValueLease& operator=(ValueLease&& other) = delete;
		~ValueLease();

		std::vector<Value>& get() noexcept { return *m_values; }

	private:
		LuaScratchState* m_owner = nullptr;
		std::vector<Value>* m_values = nullptr;
	};

	ValueLease acquireValue();

private:
	void releaseValue(std::vector<Value>& values);

	ScratchBuffer<std::vector<Value>> m_valueScratch;
	size_t m_valueScratchIndex = 0;
};

} // namespace bmsx
