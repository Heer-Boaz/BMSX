#pragma once

#include "common/primitives.h"

namespace bmsx {

struct GxGpuCommandBuffer;

struct GxGpuDeviceOutput {
	const GxGpuCommandBuffer* commandBuffer = nullptr;
	u32 statusWord = 0u;
	u32 displayModeWord = 0u;
	u32 displayStartWord = 0u;
	u32 horizontalDisplayRangeWord = 0u;
	u32 verticalDisplayRangeWord = 0u;
};

} // namespace bmsx
