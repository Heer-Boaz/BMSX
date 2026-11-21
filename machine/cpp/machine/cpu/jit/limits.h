#pragma once

#include <cstddef>

#include "common/primitives.h"

namespace bmsx {

inline constexpr u8 NATIVE_BLOCK_COMPILATION_THRESHOLD = 64u;
inline constexpr u32 NATIVE_BLOCK_MAX_INSTRUCTIONS = 64u;
inline constexpr u8 NATIVE_OWN_FIELD_TEMPORARIES = 2u;
inline constexpr u32 NATIVE_IMAGE_WARMUP_MAX_PAGES = 32u;
inline constexpr u32 NATIVE_IMAGE_WARMUP_MAX_HINTS = 256u;
inline constexpr size_t NATIVE_CODE_CACHE_MAX_BYTES = 32u * 1024u * 1024u;

} // namespace bmsx
