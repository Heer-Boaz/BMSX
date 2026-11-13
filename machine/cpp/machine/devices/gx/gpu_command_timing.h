#pragma once

#include "machine/devices/gx/gpu_command_buffer.h"

namespace bmsx {

constexpr i64 GX_GPU_COMMAND_TICKS_PER_CPU_CYCLE = 2;

i64 gxGpuCommandTicks(const GxGpuCommandStorage& commands, size_t commandIndex);

} // namespace bmsx
