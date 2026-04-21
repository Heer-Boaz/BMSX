#pragma once

#include "core/primitives.h"

#include <stdexcept>
#include <string>

namespace bmsx {

inline std::runtime_error runtimeFault(const std::string& message) {
	return BMSX_RUNTIME_ERROR("Runtime fault: " + message);
}

} // namespace bmsx
