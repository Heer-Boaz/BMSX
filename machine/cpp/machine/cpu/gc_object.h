#pragma once
#include <cstdint>
#include "spec/bmsx/memory_map.h"

namespace bmsx {
inline constexpr uint32_t GC_COLOR_OFFSET = 1;
inline constexpr uint8_t GC_COLOR_MASK = 0x03;
inline constexpr uint32_t GC_RECORD_SHIFT = 3;
inline constexpr uint32_t GC_RECORD_ALIGNMENT = 1u << GC_RECORD_SHIFT;
inline constexpr uint32_t GC_RECORD_MASK = MAIN_RAM_SIZE - GC_RECORD_ALIGNMENT;
// The record address names the aligned payload; the preceding word links
// this object into the collector's inventory. This prefix is not guest charge.
inline constexpr uint32_t GC_OBJECT_PREFIX = GC_RECORD_ALIGNMENT;
inline constexpr uint32_t GC_OBJECT_LINK_BEFORE = sizeof(uint32_t);
inline constexpr uint32_t GC_RECORD_LINK = 4;
// A four-MiB RAM bank has 19 index bits at eight-byte record alignment.
inline constexpr uint32_t GC_GRAY_INDEX_BITS = 19;
inline constexpr uint32_t GC_GRAY_INDEX_MASK = (1u << GC_GRAY_INDEX_BITS) - 1;
} // namespace bmsx
