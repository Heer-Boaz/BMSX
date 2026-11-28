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
	  m_start(monotonicNanoseconds()) {}

NativeGateProfileFrame::~NativeGateProfileFrame() {
	const u64 end = monotonicNanoseconds();
	const NativeGateProfile after = m_cpu ? m_cpu->nativeGateProfile() : NativeGateProfile{};
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
	const u64 directJumps = after.directRegisterJumpResumes - m_before.directRegisterJumpResumes;
	const u64 directWindows = after.directWindowTransferResumes - m_before.directWindowTransferResumes;
	const u64 dispatches = total.entries - directJumps - directWindows;
	const auto& enter = after.windowEnterFallbacks;
	const auto& oldEnter = m_before.windowEnterFallbacks;
	const auto& leave = after.windowLeaveFallbacks;
	const auto& oldLeave = m_before.windowLeaveFallbacks;
	// Logging is outside the measured core interval. These are event counts,
	// not estimates of time spent in helpers or generated instructions.
	m_log(RETRO_LOG_INFO,
		"[BMSX][native-gate-profile] retro_run_index=%llu begin_monotonic_ns=%llu end_monotonic_ns=%llu cpu_present=%u dispatch_entries=%llu native_resumes=%llu null_returns=%llu dispatch_exceptions=%llu builtin_attempts=%llu builtin_declines=%llu builtin_resumes=%llu builtin_stops=%llu unique_handling=%llu raw_cpp_entries=%llu direct_register_jumps=%llu direct_window_transfers=%llu"
		" window_enter_budget=%llu window_enter_pending_call=%llu window_enter_other=%llu window_leave_budget=%llu window_leave_pending_call=%llu window_leave_other=%llu\n",
		static_cast<unsigned long long>(m_index), static_cast<unsigned long long>(m_start),
		static_cast<unsigned long long>(end), static_cast<unsigned>(m_cpu != nullptr),
		static_cast<unsigned long long>(dispatches), static_cast<unsigned long long>(total.resumes),
		static_cast<unsigned long long>(total.returns), static_cast<unsigned long long>(total.exceptions),
		static_cast<unsigned long long>(attempts), static_cast<unsigned long long>(declines),
		static_cast<unsigned long long>(resumes), static_cast<unsigned long long>(stops),
		static_cast<unsigned long long>(total.entries + resumes + stops),
		static_cast<unsigned long long>(dispatches + attempts),
		static_cast<unsigned long long>(directJumps), static_cast<unsigned long long>(directWindows),
		static_cast<unsigned long long>(enter.budget - oldEnter.budget),
		static_cast<unsigned long long>(enter.pendingCall - oldEnter.pendingCall),
		static_cast<unsigned long long>(enter.other - oldEnter.other),
		static_cast<unsigned long long>(leave.budget - oldLeave.budget),
		static_cast<unsigned long long>(leave.pendingCall - oldLeave.pendingCall),
		static_cast<unsigned long long>(leave.other - oldLeave.other));
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
