#pragma once

#include "common/primitives.h"

#include <string>

namespace bmsx {

struct SourcePosition {
	i32 line = 0;
	i32 column = 0;
};

struct SourceRange {
	std::string path;
	SourcePosition start;
	SourcePosition end;
};

} // namespace bmsx
