#pragma once

#include "common/primitives.h"

#include <cstddef>
#include <span>

namespace bmsx {

class Runtime;

size_t libretroStateSize(const Runtime& runtime);
bool serializeLibretroState(Runtime& runtime, std::span<u8> envelope);
bool unserializeLibretroState(Runtime& runtime, std::span<const u8> envelope);

} // namespace bmsx
