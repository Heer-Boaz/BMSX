#pragma once

#include "machine/runtime/timing/constants.h"

namespace bmsx {

i64 calcCyclesPerFrameScaled(i64 cpuHz, i64 refreshHzScaled);
i64 resolveVblankCycles(i64 cpuFreqHz, i64 ufpsScaled, i64 totalScanlines, i32 renderHeight);


} // namespace bmsx
