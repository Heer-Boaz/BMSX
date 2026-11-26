#pragma once

#include <cstdint>

namespace bmsx {

enum class RunResult {
	Halted,
	Yielded,
	ExecutionStopped,
	ParkedAllocation,
};

enum class CpuRunKind : uint8_t { Idle, Direct, Scheduled };

} // namespace bmsx
