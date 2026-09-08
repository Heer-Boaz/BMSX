#pragma once

#include "common/primitives.h"

namespace bmsx {

enum class CapturedLocalKind : u32 {
	Local,
	Parameter,
	Receiver,
};

} // namespace bmsx
