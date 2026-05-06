#pragma once

#include "machine/runtime/timing/state.h"

namespace bmsx {

int calcCyclesPerFrame(i64 cpuHz, i64 refreshHzScaled);
i64 resolveVblankCycles(i64 cpuHz, i64 refreshHzScaled, i32 renderHeight);


} // namespace bmsx
