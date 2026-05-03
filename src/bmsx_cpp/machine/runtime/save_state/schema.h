#pragma once

#include "core/primitives.h"
#include <string>
#include <vector>

namespace bmsx {

constexpr u8 RUNTIME_SAVE_STATE_WIRE_VERSION = 6;

const std::vector<std::string>& runtimeSaveStatePropNames();

} // namespace bmsx
