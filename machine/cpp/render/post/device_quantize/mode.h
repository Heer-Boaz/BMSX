#pragma once

#include "common/types.h"

namespace bmsx {

enum class DeviceQuantizeMode : i32 {
	None = 0,
	PsxRgb555 = 1,
	Rgb777Output = 2,
	Msx10Rgb343 = 3,
};

} // namespace bmsx
