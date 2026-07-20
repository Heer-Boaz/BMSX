#pragma once

#include "common/primitives.h"

namespace bmsx {

class Runtime;

void refreshDeviceTimings(Runtime& runtime, i64 nowCycles);
void setCycleBudgetPerFrame(Runtime& runtime, i64 value);
void setFrameTiming(Runtime& runtime, i64 cpuHz, i64 cycleBudgetPerFrame);

} // namespace bmsx
