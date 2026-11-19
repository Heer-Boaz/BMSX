#include "native_gate_profile.h"

#include <time.h>

#include "machine/cpu/cpu.h"

namespace bmsx {
namespace {

u64 nextRunIndex = 0;

u64 monotonicNanoseconds() {
	timespec now;
	clock_gettime(CLOCK_MONOTONIC, &now);
	return static_cast<u64>(now.tv_sec) * 1000000000u + static_cast<u64>(now.tv_nsec);
}

} // namespace

void resetLibretroNativeGateProfile() { nextRunIndex = 0; }

NativeGateProfileFrame::NativeGateProfileFrame(const CPU* cpu, decltype(retro_log_callback::log) log)
	: m_cpu(cpu), m_log(log), m_index(nextRunIndex++),
	  m_before(cpu ? cpu->nativeGateProfile() : NativeGateProfile{}),
	  m_gcBefore(cpu ? cpu->diagnosticGcProfile() : DiagnosticGcProfile{}),
	  m_start(monotonicNanoseconds()) {}

NativeGateProfileFrame::~NativeGateProfileFrame() {
	const u64 end = monotonicNanoseconds();
	const NativeGateProfile after = m_cpu ? m_cpu->nativeGateProfile() : NativeGateProfile{};
	const DiagnosticGcProfile gc = m_cpu ? m_cpu->diagnosticGcProfile() : DiagnosticGcProfile{};
	NativeGateExitProfile total;
	for (size_t kind = 0; kind < after.exits.size(); ++kind) {
		total.entries += after.exits[kind].entries - m_before.exits[kind].entries;
		total.resumes += after.exits[kind].resumes - m_before.exits[kind].resumes;
		total.returns += after.exits[kind].returns - m_before.exits[kind].returns;
		total.exceptions += after.exits[kind].exceptions - m_before.exits[kind].exceptions;
	}
	const u64 attempts = after.builtinAttempts - m_before.builtinAttempts;
	const u64 declines = after.builtinDeclines - m_before.builtinDeclines;
	const u64 resumes = after.builtinResumes - m_before.builtinResumes;
	const u64 stops = after.builtinStops - m_before.builtinStops;
	// Logging is outside the measured core interval. These are event counts,
	// not estimates of time spent in helpers or generated instructions.
	m_log(RETRO_LOG_INFO,
		"[BMSX][native-gate-profile] retro_run_index=%llu begin_monotonic_ns=%llu end_monotonic_ns=%llu cpu_present=%u dispatch_entries=%llu native_resumes=%llu null_returns=%llu dispatch_exceptions=%llu builtin_attempts=%llu builtin_declines=%llu builtin_resumes=%llu builtin_stops=%llu unique_handling=%llu raw_cpp_entries=%llu gc_collections=%llu gc_total_ns=%llu gc_roots_ns=%llu gc_trace_ns=%llu gc_weak_ns=%llu gc_sweep_ns=%llu gc_string_reclaim_ns=%llu gc_full_collections=%llu gc_steps=%llu gc_max_step_lifetime_ns=%llu gc_steps_over_2ms=%llu gc_steps_over_8ms=%llu gc_mark_again_ns=%llu gc_atomic_ns=%llu gc_minor_collections=%llu gc_minor_ns=%llu\n",
		static_cast<unsigned long long>(m_index), static_cast<unsigned long long>(m_start),
		static_cast<unsigned long long>(end), static_cast<unsigned>(m_cpu != nullptr),
		static_cast<unsigned long long>(total.entries), static_cast<unsigned long long>(total.resumes),
		static_cast<unsigned long long>(total.returns), static_cast<unsigned long long>(total.exceptions),
		static_cast<unsigned long long>(attempts), static_cast<unsigned long long>(declines),
		static_cast<unsigned long long>(resumes), static_cast<unsigned long long>(stops),
		static_cast<unsigned long long>(total.entries + resumes + stops),
		static_cast<unsigned long long>(total.entries + attempts),
		static_cast<unsigned long long>(gc.collections - m_gcBefore.collections),
		static_cast<unsigned long long>(gc.totalNanoseconds - m_gcBefore.totalNanoseconds),
		static_cast<unsigned long long>(gc.rootsNanoseconds - m_gcBefore.rootsNanoseconds),
		static_cast<unsigned long long>(gc.traceNanoseconds - m_gcBefore.traceNanoseconds),
		static_cast<unsigned long long>(gc.weakNanoseconds - m_gcBefore.weakNanoseconds),
		static_cast<unsigned long long>(gc.sweepNanoseconds - m_gcBefore.sweepNanoseconds),
		static_cast<unsigned long long>(gc.stringReclaimNanoseconds - m_gcBefore.stringReclaimNanoseconds),
		static_cast<unsigned long long>(gc.fullCollections - m_gcBefore.fullCollections),
		static_cast<unsigned long long>(gc.steps - m_gcBefore.steps),
		static_cast<unsigned long long>(gc.maxStepNanoseconds),
		static_cast<unsigned long long>(gc.stepsOver2ms - m_gcBefore.stepsOver2ms),
		static_cast<unsigned long long>(gc.stepsOver8ms - m_gcBefore.stepsOver8ms),
		static_cast<unsigned long long>(gc.markAgainNanoseconds - m_gcBefore.markAgainNanoseconds),
		static_cast<unsigned long long>(gc.atomicNanoseconds - m_gcBefore.atomicNanoseconds),
		static_cast<unsigned long long>(gc.minorCollections - m_gcBefore.minorCollections),
		static_cast<unsigned long long>(gc.minorNanoseconds - m_gcBefore.minorNanoseconds));
	for (size_t kind = 0; kind < after.exits.size(); ++kind) {
		const auto& before = m_before.exits[kind];
		const auto& current = after.exits[kind];
		if (current.entries == before.entries) continue;
		m_log(RETRO_LOG_INFO,
			"[BMSX][native-gate-exit] retro_run_index=%llu kind=%s entries=%llu native_resumes=%llu null_returns=%llu exceptions=%llu\n",
			static_cast<unsigned long long>(m_index), NATIVE_GATE_EXIT_NAMES[kind],
			static_cast<unsigned long long>(current.entries - before.entries),
			static_cast<unsigned long long>(current.resumes - before.resumes),
			static_cast<unsigned long long>(current.returns - before.returns),
			static_cast<unsigned long long>(current.exceptions - before.exceptions));
	}
}

} // namespace bmsx
