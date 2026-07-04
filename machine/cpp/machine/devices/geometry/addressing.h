#pragma once

#include <cstdint>

namespace bmsx {

uint32_t geometryByteAddr(uint32_t base, uint64_t offset);
uint32_t geometryIndexedAddr(uint32_t base, uint32_t index, uint32_t stride);

} // namespace bmsx
