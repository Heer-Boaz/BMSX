#pragma once

#include <cstddef>
#include <cstdint>
#include <span>

namespace bmsx {

struct NativePerfMapRange {
	// Actual instruction-byte address, not a tagged callable handle.
	std::uintptr_t start;
	size_t bytes;
	const char* symbol;
};

// Linux host-native backend diagnostics, not guest machine state or timing.
// Called only for executable allocations admitted by their publication owner.
// Standard perf maps have no timestamps: code-address reuse cannot distinguish
// earlier retired code in a recording. Keep the map with the matching capture.
void recordNativePerfMap(std::span<const NativePerfMapRange> ranges);

} // namespace bmsx
