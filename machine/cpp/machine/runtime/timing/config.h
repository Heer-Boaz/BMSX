#pragma once

#include "common/primitives.h"

namespace bmsx {

class Runtime;

struct RuntimeTransferRates {
	i64 dmaWordsPerSec;
	int geoWorkUnitsPerSec;
};

void refreshDeviceTimings(Runtime& runtime, i64 nowCycles);
void setCycleBudgetPerFrame(Runtime& runtime, i64 value);
void setFrameTiming(Runtime& runtime, i64 cpuHz, i64 cycleBudgetPerFrame);
void setTransferRates(Runtime& runtime, const RuntimeTransferRates& rates);

} // namespace bmsx
