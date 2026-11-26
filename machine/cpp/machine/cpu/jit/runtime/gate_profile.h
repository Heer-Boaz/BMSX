#pragma once

#include <array>

#include "machine/cpu/jit/exit_contract.h"

namespace bmsx {

// CPU-thread lifetime measurements, independent of guest state and rewind.
// Returns counts actual null dispatch results; exceptions are a subset.
struct NativeGateExitProfile {
	u64 entries = 0;
	u64 resumes = 0;
	u64 returns = 0;
	u64 exceptions = 0;
};

struct NativeGateProfile {
	std::array<NativeGateExitProfile, static_cast<size_t>(NativeBlockExit::Count)> exits{};
	// Only grants that actually execute decoded fixed System firmware.
	u64 privateFirmwareEntries = 0;
	u64 privateFirmwareCycles = 0;
	u32 lastPrivateFirmwareEntryPc = 0;
	u64 builtinAttempts = 0;
	u64 builtinDeclines = 0;
	u64 builtinResumes = 0;
	u64 builtinStops = 0;
};

inline constexpr auto NATIVE_GATE_EXIT_NAMES = std::to_array<const char*>({
	"Continue", "ScalarBoundary", "Halt", "Call", "CompletedCall", "Return",
	"ReadField", "WriteField", "ReadMemory", "WriteMemory", "SkipInstruction",
	"WriteUpvalue", "Vararg", "InvalidConstant", "InvalidOperand", "ReadIndex", "WriteIndex",
	"ReadInteger", "WriteInteger", "Length", "BiosCall", "ControlFault",
	"ControlBoundary", "ExceptionReturn", "Concat", "ConcatRange",
	"CreateClosure", "WriteWords", "WriteControl", "WriteGlobal", "WriteSystemGlobal", "ReadUpvalue", "IterateTable",
});
static_assert(NATIVE_GATE_EXIT_NAMES.size() == static_cast<size_t>(NativeBlockExit::Count));

} // namespace bmsx
