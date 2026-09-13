#pragma once

#include <string>
#include <variant>
#include <vector>

namespace bmsx {

// Exact channel selection at code generation, not a guest runtime filter.
using TraceStatementSelection = std::variant<std::string, std::vector<std::string>>;

} // namespace bmsx
