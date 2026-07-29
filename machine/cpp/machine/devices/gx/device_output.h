#pragma once

#include "common/primitives.h"
#include "machine/devices/gx/gpu_command_buffer.h"
#include "machine/devices/gx/gpu_pcrtc.h"

#include <array>
#include <span>

namespace bmsx {

struct GxGpuDeviceOutput {
	GxGpuDeviceOutput(
		const GxGpuCommandBuffer& commandBufferOwner,
		GxGpuReadbackPort& readbackPortOwner,
		const std::array<u32, GX_GPU_PCRTC_CONFIG_WORD_COUNT>& pcrtcWordsOwner,
		const GxGpuPcrtcTiming& pcrtcTimingOwner,
		const GxGpuPcrtcScanout& pcrtcScanoutOwner,
		std::span<const u8> vramSnapshotOwner)
		: commandBuffer(commandBufferOwner)
		, readbackPort(readbackPortOwner)
		, pcrtcWords(pcrtcWordsOwner)
		, pcrtcTiming(pcrtcTimingOwner)
		, pcrtcScanout(pcrtcScanoutOwner)
		, vramSnapshotBytes(vramSnapshotOwner) {
	}

	const GxGpuCommandBuffer& commandBuffer;
	GxGpuReadbackPort& readbackPort;
	u32 statusWord = 0u;
	u32 displayModeWord = 0u;
	u32 displayStartWord = 0u;
	u32 vramYAddressExtensionWord = 0u;
	u32 horizontalDisplayRangeWord = 0u;
	u32 verticalDisplayRangeWord = 0u;
	const std::array<u32, GX_GPU_PCRTC_CONFIG_WORD_COUNT>& pcrtcWords;
	const GxGpuPcrtcTiming& pcrtcTiming;
	const GxGpuPcrtcScanout& pcrtcScanout;
	std::span<const u8> vramSnapshotBytes;
	u64 vramSnapshotSerial = 0u;
	u64 vramReplacementSerial = 0u;
};

} // namespace bmsx
