#pragma once

#include "common/primitives.h"

#include <cstddef>
#include <vector>

namespace bmsx {

struct GxGpuSoftwareState {
	explicit GxGpuSoftwareState(size_t vramByteCount, size_t interlacedPixelCount)
		: vram(vramByteCount >> 1u)
		, vramWordMask(vram.size() - 1u)
		, vramSnapshotScratch(vramByteCount)
		, interlacedPixels(interlacedPixelCount) {
	}

	std::vector<u16> vram;
	size_t vramWordMask;
	std::vector<u8> vramSnapshotScratch;
	size_t processedCommandCount = 0u;
	u32 processedCommandSerial = 0u;
	u64 vramSnapshotSerial = 0u;
	std::vector<u32> interlacedPixels;
	i32 interlacedWidth = 0;
	i32 interlacedHeight = 0;
	bool interlacedValid = false;
	u64 interlacedVramReplacementSerial = 0u;
};

} // namespace bmsx
