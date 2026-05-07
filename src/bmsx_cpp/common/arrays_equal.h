#pragma once

#include <cstddef>

namespace bmsx {

template<typename A, typename B>
bool arrays_equal(const A& a, const B& b) {
	if (a.size() != b.size()) {
		return false;
	}
	for (size_t index = 0; index < a.size(); ++index) {
		if (a[index] != b[index]) {
			return false;
		}
	}
	return true;
}

template<typename T, typename U>
bool arrays_equal(const T* a, const U* b, size_t length) {
	for (size_t index = 0; index < length; ++index) {
		if (a[index] != b[index]) {
			return false;
		}
	}
	return true;
}

} // namespace bmsx
