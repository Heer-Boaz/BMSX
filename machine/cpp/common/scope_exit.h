#pragma once

#include <utility>

namespace bmsx {

template<typename Callback>
class ScopeExit {
public:
	explicit ScopeExit(Callback callback)
		: m_callback(std::move(callback)) {
	}
	ScopeExit(const ScopeExit&) = delete;
	ScopeExit& operator=(const ScopeExit&) = delete;
	~ScopeExit() { m_callback(); }

private:
	Callback m_callback;
};

} // namespace bmsx
