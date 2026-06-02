#pragma once

#include "common/primitives.h"

namespace bmsx {

constexpr i64 HZ_SCALE = 1'000'000;
constexpr i64 DEFAULT_UFPS_SCALED = 50 * HZ_SCALE;
constexpr f64 DEFAULT_UFPS = static_cast<f64>(DEFAULT_UFPS_SCALED) / static_cast<f64>(HZ_SCALE);
constexpr f64 DEFAULT_FRAME_TIME_SEC = static_cast<f64>(HZ_SCALE) / static_cast<f64>(DEFAULT_UFPS_SCALED);
constexpr f64 DEFAULT_FRAME_TIME_MS = 1000.0 * static_cast<f64>(HZ_SCALE) / static_cast<f64>(DEFAULT_UFPS_SCALED);

} // namespace bmsx
