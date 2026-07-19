#pragma once

#include "common/types.h"

#include <array>

namespace bmsx {

enum class DeviceQuantizeMode : i32 {
	None = 0,
	Rgb565 = 1,
	Msx10Rgb343 = 2,
};

inline constexpr std::array<std::array<f32, 3>, 3> DEVICE_QUANTIZE_LEVELS{{
	{{0.0f, 0.0f, 0.0f}},
	{{31.0f, 63.0f, 31.0f}},
	{{7.0f, 15.0f, 7.0f}},
}};

} // namespace bmsx
