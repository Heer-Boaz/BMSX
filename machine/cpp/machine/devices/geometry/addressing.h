#pragma once

#include <cstdint>

namespace bmsx {

constexpr uint32_t GEOMETRY_WORD_ALIGN_MASK = 3u;

uint32_t geometryByteAddr(uint32_t base, uint64_t offset);
uint32_t geometryIndexedAddr(uint32_t base, uint32_t index, uint32_t stride);
bool geometryByteSpanFits(uint32_t base, uint64_t offset, uint64_t byteLength);
bool geometryIndexedSpanFits(uint32_t base, uint32_t index, uint32_t stride, uint64_t byteLength);

} // namespace bmsx
