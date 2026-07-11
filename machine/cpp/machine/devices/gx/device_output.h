#pragma once

#include "common/primitives.h"
#include "machine/devices/gx/gpu_command_buffer.h"

#include <array>

namespace bmsx {

struct GxGpuCommandBuffer;

struct GxGpuDeviceOutput {
	const GxGpuCommandBuffer* commandBuffer = nullptr;
	GxGpuReadbackPort* readbackPort = nullptr;
	u32 statusWord = 0u;
	u32 displayModeWord = 0u;
	u32 displayStartWord = 0u;
	u32 horizontalDisplayRangeWord = 0u;
	u32 verticalDisplayRangeWord = 0u;
	const std::array<u8, GX_GPU_VRAM_BYTE_COUNT>* vramSnapshotBytes = nullptr;
	u32 vramSnapshotSerial = 0u;
};

} // namespace bmsx
