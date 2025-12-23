/*
 * clamp.h - Clamp utility
 */

#ifndef BMSX_CLAMP_H
#define BMSX_CLAMP_H

#include <algorithm>

namespace bmsx {

template<typename T>
constexpr T clamp(T value, T min, T max) {
	return std::max(min, std::min(value, max));
}

} // namespace bmsx

#endif // BMSX_CLAMP_H
