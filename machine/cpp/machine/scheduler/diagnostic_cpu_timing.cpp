#include "machine/scheduler/diagnostic_cpu_timing.h"
#include <cstdlib>

namespace bmsx {

DiagnosticCpuSliceMeasurement::DiagnosticCpuSliceMeasurement(
	DiagnosticCpuTiming& timing, int grant, const int& remaining)
	: m_timing(timing), m_grant(grant), m_remaining(remaining) {
	if (clock_gettime(CLOCK_MONOTONIC, &m_wallStart) != 0
		|| clock_gettime(CLOCK_THREAD_CPUTIME_ID, &m_threadStart) != 0) std::abort();
}

DiagnosticCpuSliceMeasurement::~DiagnosticCpuSliceMeasurement() {
	timespec threadEnd, wallEnd;
	if (clock_gettime(CLOCK_THREAD_CPUTIME_ID, &threadEnd) != 0
		|| clock_gettime(CLOCK_MONOTONIC, &wallEnd) != 0) std::abort();
	++m_timing.slices;
	m_timing.consumedCycles += static_cast<i64>(m_grant) - m_remaining;
	m_timing.wallNanoseconds +=
		static_cast<i64>(wallEnd.tv_sec - m_wallStart.tv_sec) * 1000000000
		+ wallEnd.tv_nsec - m_wallStart.tv_nsec;
	m_timing.threadNanoseconds +=
		static_cast<i64>(threadEnd.tv_sec - m_threadStart.tv_sec) * 1000000000
		+ threadEnd.tv_nsec - m_threadStart.tv_nsec;
}

} // namespace bmsx
