#pragma once

#include "common/primitives.h"

namespace bmsx {

// Owned by the active rendering backend. All times are CPU-side elapsed
// times, including any time spent inside a driver call, not GPU timers.
struct GxUploadProfileFrame {
	u64 renderFrameSerial;
	u64 commands;
	u64 logicalBytes;
	u64 hostCalls;
	u64 hostBytes;
	u64 elapsedNanoseconds;
	u64 maxCommandNanoseconds;
	u64 softwareScanoutPixels;
	u64 softwareScanoutNanoseconds;
	u64 scanoutUploadCalls;
	u64 scanoutUploadBytes;
	u64 scanoutUploadNanoseconds;

	void recordCpuToVram(u64 bytes, u64 glCalls, u64 glBytes, u64 elapsed) {
		commands += 1u;
		logicalBytes += bytes;
		hostCalls += glCalls;
		hostBytes += glBytes;
		elapsedNanoseconds += elapsed;
		if (maxCommandNanoseconds < elapsed) maxCommandNanoseconds = elapsed;
	}
};

} // namespace bmsx
