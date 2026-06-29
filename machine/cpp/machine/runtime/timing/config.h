#pragma once

#include "common/primitives.h"

namespace bmsx {

class Runtime;

struct RuntimeTransferRates {
	i64 imgDecBytesPerSec;
	i64 dmaBytesPerSecIso;
	i64 dmaBytesPerSecBulk;
	int vdpWorkUnitsPerSec;
	int geoWorkUnitsPerSec;
};

void refreshDeviceTimings(Runtime& runtime, i64 nowCycles);
void setCycleBudgetPerFrame(Runtime& runtime, int value);
void setFrameTiming(Runtime& runtime, i64 cpuHz, int cycleBudgetPerFrame, int vblankCycles);
void setTransferRates(Runtime& runtime, const RuntimeTransferRates& rates);

} // namespace bmsx
