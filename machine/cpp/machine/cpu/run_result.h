#pragma once

#include <cstdint>

namespace bmsx {

enum class RunResult {
	Halted,
	Yielded,
	ExecutionStopped,
	ParkedAllocation,
	CollectionProgress,
};

enum class CpuRunKind : uint8_t { Idle, Direct, Scheduled };

} // namespace bmsx
