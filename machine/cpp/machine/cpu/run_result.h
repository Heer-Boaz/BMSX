#pragma once

#include <cstdint>

namespace bmsx {

enum class RunResult {
	Halted,
	Yielded,
	ExecutionStopped,
	ParkedTableWrite,
};

enum class CpuRunKind : uint8_t { Direct, Scheduled };

} // namespace bmsx
