#pragma once

#include <chrono>

namespace bmsx {

inline double to_ms(std::chrono::steady_clock::duration duration) {
	return std::chrono::duration<double, std::milli>(duration).count();
}

} // namespace bmsx
