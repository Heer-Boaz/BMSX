#pragma once

#include "common/primitives.h"

namespace bmsx {

inline u32 alignUp(u32 value, u32 alignment) {
	const u32 mask = alignment - 1u;
	return (value + mask) & ~mask;
}

} // namespace bmsx
