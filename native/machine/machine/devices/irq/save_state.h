#pragma once

#include <cstdint>

namespace bmsx {

struct IrqControllerState {
	uint32_t pendingFlags = 0;
};

} // namespace bmsx
