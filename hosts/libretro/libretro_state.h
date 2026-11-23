#pragma once

#include "common/primitives.h"

#include <array>
#include <cstddef>
#include <span>

namespace bmsx {

class Runtime;
class LibretroContent;

using LibretroMediaIdentity = std::array<u8, 16>;
inline constexpr size_t LIBRETRO_STATE_HEADER_BYTES = 2u * sizeof(u32) + std::tuple_size_v<LibretroMediaIdentity>;

size_t libretroStateSize(const Runtime& runtime);
bool serializeLibretroState(LibretroContent& content, std::span<u8> envelope);
bool unserializeLibretroState(LibretroContent& content, std::span<const u8> envelope);

} // namespace bmsx
