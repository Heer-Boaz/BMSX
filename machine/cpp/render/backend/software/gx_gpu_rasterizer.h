#pragma once

#include "common/primitives.h"

#include <cstddef>

namespace bmsx {

struct GxGpuCommandBuffer;

void drawGxGpuSoftwareRectangle(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex, i32 x0, i32 y0, u32 width, u32 height, u32 colorWord);
void drawGxGpuSoftwareTriangle(
	const GxGpuCommandBuffer& commandBuffer,
	size_t commandIndex,
	i32 x0,
	i32 y0,
	u32 color0,
	i32 x1,
	i32 y1,
	u32 color1,
	i32 x2,
	i32 y2,
	u32 color2,
	bool ditherEnabled);
void drawGxGpuSoftwareLineSegment(const GxGpuCommandBuffer& commandBuffer, size_t commandIndex, i32 x0, i32 y0, u32 color0, i32 x1, i32 y1, u32 color1);

} // namespace bmsx
