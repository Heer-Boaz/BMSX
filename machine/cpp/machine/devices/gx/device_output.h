#pragma once

#include "common/primitives.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "machine/devices/gx/system_vram_port.h"

#include <array>

namespace bmsx {

struct GxGpuCommandBuffer;

struct GxGpuDeviceOutput {
	GxGpuDeviceOutput(
		GxGpuCommandBuffer& commandBufferOwner,
		GxGpuSystemVramPort& systemVramPortOwner,
		const std::array<u8, GX_GPU_VRAM_BYTE_COUNT>& vramSnapshotOwner)
		: commandBuffer(commandBufferOwner)
		, systemVramPort(systemVramPortOwner)
		, readbackPort(commandBufferOwner.readback)
		, vramSnapshotBytes(vramSnapshotOwner) {
	}

	const GxGpuCommandBuffer& commandBuffer;
	const GxGpuSystemVramPort& systemVramPort;
	GxGpuReadbackPort& readbackPort;
	u32 statusWord = 0u;
	u32 displayModeWord = 0u;
	u32 displayStartWord = 0u;
	u32 horizontalDisplayRangeWord = 0u;
	u32 verticalDisplayRangeWord = 0u;
	u32 display2StartWord = 0u;
	u32 display2SizeWord = 0u;
	u32 compositorControlWord = 0u;
	const std::array<u8, GX_GPU_VRAM_BYTE_COUNT>& vramSnapshotBytes;
	u64 vramSnapshotSerial = 0u;
};

} // namespace bmsx
