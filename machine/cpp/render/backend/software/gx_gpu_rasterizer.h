#pragma once

#include "common/primitives.h"

#include <cstddef>

namespace bmsx {

struct GxGpuCommandBuffer;
struct GxGpuSoftwareState;

void drawGxGpuSoftwareRectangle(
	GxGpuSoftwareState& software,
	const GxGpuCommandBuffer& commandBuffer,
	size_t commandIndex,
	i32 x0,
	i32 y0,
	u32 width,
	u32 height,
	u32 colorWord);
void drawGxGpuSoftwareTriangle(
	GxGpuSoftwareState& software,
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
void drawGxGpuSoftwareTexturedTriangle(
	GxGpuSoftwareState& software,
	const GxGpuCommandBuffer& commandBuffer,
	size_t commandIndex,
	i32 x0,
	i32 y0,
	u32 color0,
	i32 u0,
	i32 v0,
	i32 x1,
	i32 y1,
	u32 color1,
	i32 u1,
	i32 v1,
	i32 x2,
	i32 y2,
	u32 color2,
	i32 u2,
	i32 v2,
	bool ditherEnabled);
void drawGxGpuSoftwareTexturedRectangle(
	GxGpuSoftwareState& software,
	const GxGpuCommandBuffer& commandBuffer,
	size_t commandIndex,
	i32 x0,
	i32 y0,
	u32 width,
	u32 height,
	u32 colorWord,
	u32 textureWord);
void drawGxGpuSoftwareLineSegment(
	GxGpuSoftwareState& software,
	const GxGpuCommandBuffer& commandBuffer,
	size_t commandIndex,
	i32 x0,
	i32 y0,
	u32 color0,
	i32 x1,
	i32 y1,
	u32 color1);

} // namespace bmsx
