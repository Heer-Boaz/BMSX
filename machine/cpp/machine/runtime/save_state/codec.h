#pragma once

#include "common/primitives.h"
#include "machine/runtime/save_state.h"
#include <cstddef>
#include <vector>

namespace bmsx {

class Runtime;

constexpr size_t RUNTIME_SAVE_STATE_BASE_WIRE_CAPACITY = 0x01000000u;
constexpr size_t runtimeSaveStateWireCapacity(size_t cartridgeRamByteCount) {
	return RUNTIME_SAVE_STATE_BASE_WIRE_CAPACITY + cartridgeRamByteCount;
}

std::vector<u8> encodeRuntimeSaveState(const RuntimeSaveState& state);
RuntimeSaveState decodeRuntimeSaveState(const u8* data, size_t size, size_t cartridgeRamByteCount);
RuntimeSaveState decodeRuntimeSaveState(const std::vector<u8>& data, size_t cartridgeRamByteCount);

std::vector<u8> captureRuntimeSaveStateBytes(Runtime& runtime);
void applyRuntimeSaveStateBytes(Runtime& runtime, const u8* data, size_t size);
void applyRuntimeSaveStateBytes(Runtime& runtime, const std::vector<u8>& data);

} // namespace bmsx
