#pragma once

#include "common/types.h"

namespace bmsx {

enum class DeviceQuantizeMode : i32 {
	None = 0,
	Rgb565 = 1,
	Msx10Rgb343 = 2,
};

} // namespace bmsx
