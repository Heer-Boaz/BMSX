#pragma once

#include <cstddef>

namespace bmsx {

template<typename Values, typename T>
size_t lowerBound(const Values& values, const T& target, size_t lo, size_t hi) {
	size_t left = lo;
	size_t right = hi;
	while (left < right) {
		const size_t mid = (left + right) >> 1u;
		if (values[mid] < target) {
			left = mid + 1u;
		} else {
			right = mid;
		}
	}
	return left;
}

template<typename Values, typename T>
size_t lowerBound(const Values& values, const T& target) {
	return lowerBound(values, target, 0u, values.size());
}

} // namespace bmsx
