#pragma once

#include "common/primitives.h"
#include "machine/runtime/save_state.h"
#include <cstddef>
#include <span>
#include <vector>

namespace bmsx {

class Runtime;

constexpr size_t RUNTIME_SAVE_STATE_NON_RAM_WIRE_CAPACITY = 0x00c00000u;
constexpr size_t runtimeSaveStateWireCapacity(size_t ramByteCount, size_t cartridgeRamByteCount) {
	return RUNTIME_SAVE_STATE_NON_RAM_WIRE_CAPACITY + ramByteCount + cartridgeRamByteCount;
}

std::vector<u8> encodeRuntimeSaveState(const RuntimeSaveState& state);
RuntimeSaveState decodeRuntimeSaveState(
	std::span<const u8> data,
	size_t ramByteCount,
	size_t cartridgeRamByteCount
);

std::vector<u8> captureRuntimeSaveStateBytes(Runtime& runtime);
void applyRuntimeSaveStateBytes(Runtime& runtime, std::span<const u8> data);

} // namespace bmsx
