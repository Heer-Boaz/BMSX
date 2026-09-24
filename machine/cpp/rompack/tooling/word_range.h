#pragma once

#include "common/primitives.h"

#include <vector>

namespace bmsx {

// Half-open instruction-word intervals in a finalized function, not source scopes.
struct ProgramWordRange {
	i32 start;
	i32 end;
};

// Append an ordered interval, coalescing adjacent coverage without per-word storage.
inline void appendProgramWordRange(std::vector<ProgramWordRange>& ranges, i32 start, i32 end) {
	if (!ranges.empty() && ranges.back().end == start) {
		ranges.back().end = end;
	} else {
		ranges.push_back({start, end});
	}
}

} // namespace bmsx
