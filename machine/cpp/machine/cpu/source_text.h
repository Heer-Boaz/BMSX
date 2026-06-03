#pragma once

#include "machine/cpu/cpu.h"

#include <string>

namespace bmsx {

bool extractSourceRangeText(const SourceRange& range, const std::string& source, std::string& out);

} // namespace bmsx
