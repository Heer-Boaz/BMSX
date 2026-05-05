#pragma once

#include "common/primitives.h"
#include "machine/runtime/save_state.h"
#include <cstddef>
#include <vector>

namespace bmsx {

class Runtime;

std::vector<u8> encodeRuntimeSaveState(const RuntimeSaveState& state);
RuntimeSaveState decodeRuntimeSaveState(const u8* data, size_t size);
RuntimeSaveState decodeRuntimeSaveState(const std::vector<u8>& data);

std::vector<u8> captureRuntimeSaveStateBytes(Runtime& runtime);
void applyRuntimeSaveStateBytes(Runtime& runtime, const u8* data, size_t size);
void applyRuntimeSaveStateBytes(Runtime& runtime, const std::vector<u8>& data);

} // namespace bmsx
