#pragma once

#include "rompack/tooling/blua32_symbols.h"

#include <optional>
#include <string>

namespace bmsx {

std::optional<std::string> extractSourceRangeText(const SourceRange& range, const std::string& source);

} // namespace bmsx
