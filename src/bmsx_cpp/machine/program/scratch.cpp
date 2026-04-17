#include "machine/program/scratch.h"

namespace bmsx {

std::vector<Value> LuaScratchState::acquireValue() {
	if (!m_valuePool.empty()) {
		auto scratch = std::move(m_valuePool.back());
		m_valuePool.pop_back();
		scratch.clear();
		return scratch;
	}
	return {};
}

void LuaScratchState::releaseValue(std::vector<Value>&& values) {
	values.clear();
	if (m_valuePool.size() < MAX_POOLED_SCRATCH) {
		m_valuePool.push_back(std::move(values));
	}
}

} // namespace bmsx
