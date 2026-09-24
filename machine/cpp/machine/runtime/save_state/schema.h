#pragma once

#include <span>
#include <string>

namespace bmsx {

inline constexpr int RUNTIME_SAVE_STATE_VERSION = 3;

extern const std::span<const std::string> RUNTIME_SAVE_STATE_PROP_NAMES;

} // namespace bmsx
