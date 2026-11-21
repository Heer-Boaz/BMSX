#pragma once

#include "libretro.h"
#include "machine/cpu/jit/runtime/gate_profile.h"
#include "machine/cpu/diagnostic_gc_profile.h"

namespace bmsx {

class CPU;

// The index belongs to the actual libretro invocation, including lifecycle
// returns before guest execution. CPU counters themselves remain cumulative.
void resetLibretroNativeGateProfile();

class NativeGateProfileFrame final {
public:
	NativeGateProfileFrame(const CPU* cpu, decltype(retro_log_callback::log) log);
	~NativeGateProfileFrame();
	NativeGateProfileFrame(const NativeGateProfileFrame&) = delete;
	NativeGateProfileFrame& operator=(const NativeGateProfileFrame&) = delete;

private:
	const CPU* m_cpu;
	decltype(retro_log_callback::log) m_log;
	u64 m_index;
	NativeGateProfile m_before;
	DiagnosticGcProfile m_gcBefore;
	u64 m_start;
};

} // namespace bmsx
