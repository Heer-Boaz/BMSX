#pragma once

#include "core/primitives.h"

namespace bmsx {

class Runtime;

struct RuntimeTransferRates {
	i64 imgDecBytesPerSec = 0;
	i64 dmaBytesPerSecIso = 0;
	i64 dmaBytesPerSecBulk = 0;
	int vdpWorkUnitsPerSec = 0;
	int geoWorkUnitsPerSec = 0;
};

void refreshDeviceTimings(Runtime& runtime, i64 nowCycles);
void setCpuHz(Runtime& runtime, i64 value);
void setCycleBudgetPerFrame(Runtime& runtime, int value);
void setVdpWorkUnitsPerSec(Runtime& runtime, int value);
void setGeoWorkUnitsPerSec(Runtime& runtime, int value);
void setTransferRatesFromManifest(Runtime& runtime, const RuntimeTransferRates& rates);
void applyActiveMachineTiming(Runtime& runtime, i64 cpuHz);

} // namespace bmsx
