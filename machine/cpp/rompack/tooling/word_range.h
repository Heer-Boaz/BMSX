#pragma once

#include "common/primitives.h"

namespace bmsx {

// Half-open instruction-word intervals in a finalized function, not source scopes.
struct ProgramWordRange {
	i32 start;
	i32 end;
};

} // namespace bmsx
