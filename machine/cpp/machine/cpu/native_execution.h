#pragma once

#include <exception>
#include <type_traits>

#include "machine/cpu/native_block.h"

namespace bmsx {

// A CPU grant owns this transient native frame. The register/cycle prefix is
// shared with the standalone block ABI; only the CPU dispatcher uses the tail.
struct NativeCpuRunState {
	NativeBlockRunState state;
	CPU* cpu;
	int targetDepth;
	std::exception_ptr error;
};

static_assert(std::is_standard_layout_v<NativeCpuRunState>);
static_assert(offsetof(NativeCpuRunState, state) == 0);

} // namespace bmsx
