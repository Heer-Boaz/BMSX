#pragma once

#include <cstdint>
#include <optional>

namespace bmsx {

constexpr uint32_t GEOMETRY_WORD_ALIGN_MASK = 3u;

std::optional<uint32_t> resolveGeometryByteOffset(uint32_t base, uint64_t offset, uint64_t byteLength);
std::optional<uint32_t> resolveGeometryIndexedSpan(uint32_t base, uint32_t index, uint32_t stride, uint64_t byteLength);

} // namespace bmsx
