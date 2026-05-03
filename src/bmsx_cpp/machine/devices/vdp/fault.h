#pragma once

#include "core/primitives.h"

#include <stdexcept>
#include <string>

namespace bmsx {

inline std::runtime_error vdpFault(const std::string& message) {
	return BMSX_RUNTIME_ERROR("VDP fault: " + message);
}

inline std::runtime_error vdpBackendFault(const std::string& message) {
	return BMSX_RUNTIME_ERROR("VDP backend fault: " + message);
}

} // namespace bmsx
