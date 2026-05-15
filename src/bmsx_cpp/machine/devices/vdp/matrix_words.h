#pragma once

#include "common/primitives.h"

#include <array>
#include <cstddef>

namespace bmsx {

constexpr size_t VDP_MATRIX_WORD_COUNT = 16u;
constexpr u32 VDP_MATRIX_Q16_ONE = 0x00010000u;

template <size_t WordCount>
inline void setIdentityMatrixWordsAt(std::array<u32, WordCount>& out, size_t base) {
	for (size_t index = 0u; index < VDP_MATRIX_WORD_COUNT; ++index) {
		out[base + index] = 0u;
	}
	out[base] = VDP_MATRIX_Q16_ONE;
	out[base + 5u] = VDP_MATRIX_Q16_ONE;
	out[base + 10u] = VDP_MATRIX_Q16_ONE;
	out[base + 15u] = VDP_MATRIX_Q16_ONE;
}

} // namespace bmsx
