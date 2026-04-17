#pragma once

#include "machine/cpu/cpu.h"

#include <vector>

namespace bmsx {

class LuaScratchState {
public:
	std::vector<Value> acquireValue();
	void releaseValue(std::vector<Value>&& values);

private:
	static constexpr size_t MAX_POOLED_SCRATCH = 32;
	std::vector<std::vector<Value>> m_valuePool;
};

} // namespace bmsx
