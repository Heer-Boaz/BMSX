#pragma once

#include <cstddef>
#include <cstring>

namespace bmsx {

// The Cortex-A7 stalls on two long, cold input streams. Prefetch both
// four cache lines ahead; keep the short compare and tail in libc.
inline bool bytesEqual(const char* left, const char* right, std::size_t length) {
#if defined(__ARM_ARCH_7A__) && (defined(__GNUC__) || defined(__clang__))
	while (length > 256) {
		__builtin_prefetch(left + 256);
		__builtin_prefetch(right + 256);
		if (std::memcmp(left, right, 64) != 0) return false;
		left += 64;
		right += 64;
		length -= 64;
	}
#endif
	return length == 0 || std::memcmp(left, right, length) == 0;
}

} // namespace bmsx
