#pragma once

#include "common/primitives.h"

namespace bmsx {

class Clock {
public:
	virtual ~Clock() = default;
	virtual auto now() -> f64 = 0;
};

} // namespace bmsx
