#pragma once

#include "spec/blua32/opcode.h"

#include <array>

namespace bmsx {

extern const std::array<const char*, OPCODE_COUNT> OPCODE_NAMES;
extern const std::array<const char*, OPCODE_COUNT> OPCODE_CATEGORY;

} // namespace bmsx
