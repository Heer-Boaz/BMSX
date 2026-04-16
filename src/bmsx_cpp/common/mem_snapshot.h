#pragma once

#include <string>

namespace bmsx {

// Returns a one-line memory snapshot for Linux; empty string on other platforms.
std::string memSnapshotLine(const char* label);

} // namespace bmsx
