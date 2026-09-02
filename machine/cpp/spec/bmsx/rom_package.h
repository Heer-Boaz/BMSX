#pragma once

#include "common/primitives.h"

#include <cstddef>

namespace bmsx {

constexpr u32 CART_ROM_MAGIC = 0x58534d42u;
constexpr size_t CART_ROM_HEADER_SIZE = 72u;
constexpr size_t CART_ROM_WORD_ALIGNMENT = 4u;
constexpr u32 CART_PACKAGE_MAX_BYTE_COUNT = 0xffffffffu;

constexpr size_t CART_ROM_HEADER_MAGIC_OFFSET = 0u;
constexpr size_t CART_ROM_HEADER_SIZE_OFFSET = 4u;
constexpr size_t CART_ROM_HEADER_MANIFEST_OFFSET = 8u;
constexpr size_t CART_ROM_HEADER_MANIFEST_LENGTH_OFFSET = 12u;
constexpr size_t CART_ROM_HEADER_TOC_OFFSET = 16u;
constexpr size_t CART_ROM_HEADER_TOC_LENGTH_OFFSET = 20u;
constexpr size_t CART_ROM_HEADER_DATA_OFFSET = 24u;
constexpr size_t CART_ROM_HEADER_DATA_LENGTH_OFFSET = 28u;
constexpr size_t CART_ROM_HEADER_BLUA32_DIAGNOSTIC_DIRECTORY_OFFSET = 60u;
constexpr size_t CART_ROM_HEADER_METADATA_OFFSET = 64u;
constexpr size_t CART_ROM_HEADER_METADATA_LENGTH_OFFSET = 68u;

} // namespace bmsx
