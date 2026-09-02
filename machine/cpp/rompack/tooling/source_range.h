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

inline auto sourceRangesEqual(const SourceRange& left, const SourceRange& right) -> bool {
	return left.path == right.path
		&& left.start.line == right.start.line
		&& left.start.column == right.start.column
		&& left.end.line == right.end.line
		&& left.end.column == right.end.column;
}

} // namespace bmsx
