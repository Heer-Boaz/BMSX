#pragma once

#include "common/primitives.h"
#include <string>
#include <vector>

namespace bmsx {

constexpr u8 RUNTIME_SAVE_STATE_WIRE_VERSION = 9;

extern const std::vector<std::string> RUNTIME_SAVE_STATE_PROP_NAMES;

} // namespace bmsx
