#pragma once
#include <cstdint>

namespace bmsx {
inline constexpr uint32_t GC_COLOR_OFFSET = 1;
inline constexpr uint8_t GC_COLOR_MASK = 0x03;
inline constexpr uint32_t GC_RECORD_SHIFT = 3;
inline constexpr uint32_t GC_RECORD_LINK = 4;
// A four-MiB RAM bank has 19 index bits at eight-byte record alignment.
inline constexpr uint32_t GC_GRAY_INDEX_BITS = 19;
inline constexpr uint32_t GC_GRAY_INDEX_MASK = (1u << GC_GRAY_INDEX_BITS) - 1;
} // namespace bmsx
