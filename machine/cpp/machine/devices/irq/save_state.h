#pragma once

#include <cstdint>

namespace bmsx {

struct IrqControllerState {
	uint32_t mask = 0;
	uint32_t pendingFlags = 0;
	uint32_t userMask = 0;
	uint32_t userPendingFlags = 0;
	bool supervisorContextActive = false;
};

} // namespace bmsx
