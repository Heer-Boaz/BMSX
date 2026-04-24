#pragma once

#include "core/primitives.h"
#include <string>
#include <vector>

namespace bmsx {

constexpr u8 RUNTIME_SAVE_STATE_WIRE_VERSION = 4;

const std::vector<std::string>& runtimeSaveStatePropNames();

} // namespace bmsx
