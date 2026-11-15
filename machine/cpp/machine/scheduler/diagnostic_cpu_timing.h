#pragma once

#include "common/primitives.h"
#include <time.h>

namespace bmsx {

// Linux host diagnostics, not machine state. Unlike opcode profiling, this
// adds no work to generated instructions or helper/dispatch boundaries.
struct DiagnosticCpuTiming {
	u64 slices = 0;
	i64 consumedCycles = 0;
	u64 wallNanoseconds = 0;
	u64 threadNanoseconds = 0;
};

class DiagnosticCpuSliceMeasurement {
public:
	DiagnosticCpuSliceMeasurement(DiagnosticCpuTiming& timing, int grant, const int& remaining);
	~DiagnosticCpuSliceMeasurement();
private:
	DiagnosticCpuTiming& m_timing;
	int m_grant;
	const int& m_remaining;
	timespec m_wallStart;
	timespec m_threadStart;
};

} // namespace bmsx
