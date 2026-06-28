#pragma once

#include "machine/cpu/cpu.h"

#include <optional>
#include <string>

namespace bmsx {

std::optional<std::string> extractSourceRangeText(const SourceRange& range, const std::string& source);

} // namespace bmsx
