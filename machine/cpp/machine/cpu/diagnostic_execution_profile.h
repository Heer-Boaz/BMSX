#pragma once

#include "common/primitives.h"

namespace bmsx {

// Host-only cumulative diagnostics. These are never reset or restored with
// machine state. Counts denote admitted semantic attempts, including faults.
struct DiagnosticOpcodeCounts {
	u64 biosCall = 0;
	u64 call = 0;
	u64 setfield = 0;
	u64 concat = 0;
	u64 concatn = 0;
};

// One native gate has a positive signed-int grant. Each counted opcode costs
// at least two cycles, so its temporary count fits one raw u32 register word.
struct DiagnosticNativeOpcodeCounts {
	u32 biosCall = 0;
	u32 call = 0;
	u32 setfield = 0;
	u32 concat = 0;
	u32 concatn = 0;
};

struct DiagnosticExecutionProfile {
	// Includes shared C++ semantic helpers reached from generated execution.
	i64 nativeOriginCycles = 0;
	DiagnosticOpcodeCounts nativeOpcodes;
	DiagnosticOpcodeCounts interpreterOpcodes;
};

} // namespace bmsx
