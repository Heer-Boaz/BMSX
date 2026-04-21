/*
 * clamp.h - Clamp utility
 */

#ifndef BMSX_CLAMP_H
#define BMSX_CLAMP_H

#include <algorithm>

namespace bmsx {

// @code-quality start numeric-sanitization-acceptable -- clamp implementation is the primitive that owns this bounds operation.
template<typename T>
constexpr T clamp(T value, T min, T max) {
	return std::max(min, std::min(value, max));
}
// @code-quality end numeric-sanitization-acceptable

} // namespace bmsx

#endif // BMSX_CLAMP_H
