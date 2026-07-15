#pragma once

#include "common/primitives.h"
#include "machine/devices/gx/character_plane.h"
#include "machine/devices/gx/gpu_command_buffer.h"

#include <array>

namespace bmsx {

struct GxGpuCommandBuffer;

struct GxGpuDeviceOutput {
	GxGpuDeviceOutput(
		GxGpuCommandBuffer& commandBufferOwner,
		const std::array<u8, GX_GPU_VRAM_BYTE_COUNT>& vramSnapshotOwner,
		const GxCharacterPlaneOutput& characterPlaneOwner)
		: commandBuffer(commandBufferOwner)
		, readbackPort(commandBufferOwner.readback)
		, vramSnapshotBytes(vramSnapshotOwner)
		, characterPlane(characterPlaneOwner) {
	}

	const GxGpuCommandBuffer& commandBuffer;
	GxGpuReadbackPort& readbackPort;
	u32 statusWord = 0u;
	u32 displayModeWord = 0u;
	u32 displayStartWord = 0u;
	u32 horizontalDisplayRangeWord = 0u;
	u32 verticalDisplayRangeWord = 0u;
	const std::array<u8, GX_GPU_VRAM_BYTE_COUNT>& vramSnapshotBytes;
	u64 vramSnapshotSerial = 0u;
	const GxCharacterPlaneOutput& characterPlane;
};

} // namespace bmsx
