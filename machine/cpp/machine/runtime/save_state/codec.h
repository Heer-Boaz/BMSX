#pragma once

#include "common/primitives.h"
#include "machine/runtime/save_state.h"
#include <cstddef>
#include <span>
#include <vector>

namespace bmsx {

std::vector<u8> encodeRuntimeSaveState(const RuntimeSaveState& state);
size_t encodeRuntimeSaveState(const RuntimeSaveState& state, std::span<u8> output);
RuntimeSaveState decodeRuntimeSaveState(
	std::span<const u8> data,
	size_t ramByteCount,
	size_t gxGpuVramByteCount
);

} // namespace bmsx
