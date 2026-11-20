#pragma once

#include <array>
#include "common/primitives.h"

namespace bmsx {

// A placement image for a fresh record with at most eight distinct string
// keys. Nodes name source field ordinals, not guest pointers or Values.
inline constexpr u32 TABLE_RECORD_FIELDS_MAX = 8u;
struct TableConstructorLayout {
	struct Node {
		i8 field = -1;
		i8 next = -1;
	};
	std::array<Node, TABLE_RECORD_FIELDS_MAX> nodes;
	i8 free = -1;
};

} // namespace bmsx
